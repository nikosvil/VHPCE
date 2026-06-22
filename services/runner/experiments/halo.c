/* VHPCE MPI halo-exchange kernel — the flagship "MPI Halo Exchange" experiment.
 *
 * A 1-D Jacobi-style stencil over a global array of N cells, domain-decomposed across
 * `size` ranks. Each iteration:
 *   1) exchange one boundary cell with the left and right neighbour (ring), via MPI_Sendrecv
 *   2) update every local cell from its two neighbours (3-point stencil)
 *
 * Modes (dispatched on argv[1]):
 *   strong     : global N = Nbase (fixed) -> per-rank work shrinks with ranks.
 *   weak       : global N = Nbase * size (grows) -> per-rank work stays constant.
 *   collective : MPI collective benchmarks (Bcast, Reduce, Allreduce, Alltoall).
 *                argv[2] = collective type (broadcast|reduce|allreduce|alltoall).
 *   hybrid     : MPI+OpenMP hybrid — OpenMP compute followed by MPI_Allreduce.
 *                argv[2] = threads per rank.
 *
 * Timing: the iteration loop only (after a warm-up), reduced with MPI_MAX across ranks so the
 * reported time is the slowest rank (the true wall time). Rank 0 prints that time in ms as a
 * single number on stdout; the driver (mpi-driver.sh) runs the rank sweep and builds the JSON.
 *
 * Build: mpicc -O2 -fopenmp -o halo halo.c
 * Run:   mpirun -np <k> ./halo <strong|weak|collective|hybrid> <Nbase> <iters|type|tpr>
 */
#include <mpi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#ifdef _OPENMP
#include <omp.h>
#endif

/* Flops per cell per iteration. The stencil itself is memory-bound (low arithmetic
 * intensity), which on a single node makes ranks contend for shared DRAM bandwidth and
 * ruins weak scaling. Adding a short dependent arithmetic chain per cell raises the
 * arithmetic intensity above the roofline ridge so the kernel is compute-bound — then
 * ranks on separate cores don't fight over memory and weak scaling stays ~flat (the lesson).
 * It also keeps per-rank work constant under weak scaling regardless of cache effects. */
#define FLOP 48

/* ----- collective mode: benchmark a single MPI collective type.
 *       Rank 0 prints the best-of-CREPS time in ms on stdout. ----- */
#define COLL_MSGSIZE 131072  /* 1 MB of doubles = 131072 elements */
#define CREPS 50

static void run_collective(const char *coll_type, int rank, int nproc) {
    long N = COLL_MSGSIZE;
    double *sendbuf = (double *)malloc(N * sizeof(double));
    double *recvbuf = (double *)malloc(N * sizeof(double));
    if (!sendbuf || !recvbuf) {
        if (rank == 0) fprintf(stderr, "alloc failed\n");
        MPI_Abort(MPI_COMM_WORLD, 1);
    }
    for (long i = 0; i < N; i++) sendbuf[i] = (double)(rank + i);

    int is_bcast    = (strcmp(coll_type, "broadcast") == 0);
    int is_reduce   = (strcmp(coll_type, "reduce") == 0);
    int is_allreduce = (strcmp(coll_type, "allreduce") == 0);
    /* else: alltoall */

    /* For alltoall, each rank sends/receives N/nproc elements to/from each other rank. */
    long chunk = N / nproc;
    if (chunk < 1) chunk = 1;

    /* Warm-up */
    MPI_Barrier(MPI_COMM_WORLD);
    if (is_bcast)          MPI_Bcast(sendbuf, N, MPI_DOUBLE, 0, MPI_COMM_WORLD);
    else if (is_reduce)    MPI_Reduce(sendbuf, recvbuf, N, MPI_DOUBLE, MPI_SUM, 0, MPI_COMM_WORLD);
    else if (is_allreduce) MPI_Allreduce(sendbuf, recvbuf, N, MPI_DOUBLE, MPI_SUM, MPI_COMM_WORLD);
    else                   MPI_Alltoall(sendbuf, chunk, MPI_DOUBLE, recvbuf, chunk, MPI_DOUBLE, MPI_COMM_WORLD);

    /* Timed runs: best-of-CREPS */
    double best = 1e30;
    for (int r = 0; r < CREPS; r++) {
        MPI_Barrier(MPI_COMM_WORLD);
        double t0 = MPI_Wtime();
        if (is_bcast)          MPI_Bcast(sendbuf, N, MPI_DOUBLE, 0, MPI_COMM_WORLD);
        else if (is_reduce)    MPI_Reduce(sendbuf, recvbuf, N, MPI_DOUBLE, MPI_SUM, 0, MPI_COMM_WORLD);
        else if (is_allreduce) MPI_Allreduce(sendbuf, recvbuf, N, MPI_DOUBLE, MPI_SUM, MPI_COMM_WORLD);
        else                   MPI_Alltoall(sendbuf, chunk, MPI_DOUBLE, recvbuf, chunk, MPI_DOUBLE, MPI_COMM_WORLD);
        double elapsed = MPI_Wtime() - t0;

        double maxsec = 0.0;
        MPI_Reduce(&elapsed, &maxsec, 1, MPI_DOUBLE, MPI_MAX, 0, MPI_COMM_WORLD);
        if (rank == 0 && maxsec < best) best = maxsec;
    }

    /* Anti-elision */
    double sum = 0.0;
    for (long i = 0; i < N; i++) sum += recvbuf[i];
    if (rank == 0) {
        if (sum == 1.0e300) fprintf(stderr, "noop\n");
        printf("%.3f\n", best * 1000.0);
    }
    free(sendbuf); free(recvbuf);
}

/* ----- hybrid mode: OpenMP compute + MPI_Allreduce.
 *       Each rank runs tpr threads on local compute, then communicates via Allreduce.
 *       Rank 0 prints the best-of-HREPS time in ms. ----- */
#define HYBRID_N 500000L
#define HREPS 20

static void run_hybrid(int tpr, int rank, int nproc) {
    long N = HYBRID_N;
    double *local  = (double *)malloc(N * sizeof(double));
    double *global = (double *)malloc(N * sizeof(double));
    if (!local || !global) {
        if (rank == 0) fprintf(stderr, "alloc failed\n");
        MPI_Abort(MPI_COMM_WORLD, 1);
    }
    for (long i = 0; i < N; i++) local[i] = (double)(rank + i);

    /* Warm-up */
    MPI_Barrier(MPI_COMM_WORLD);
#ifdef _OPENMP
    #pragma omp parallel for num_threads(tpr) schedule(static)
#endif
    for (long i = 0; i < N; i++) {
        double v = local[i];
        for (int q = 0; q < FLOP; q++) v = v * 0.9999990 + 1.0e-7;
        local[i] = v;
    }
    MPI_Allreduce(local, global, N, MPI_DOUBLE, MPI_SUM, MPI_COMM_WORLD);

    /* Timed runs: best-of-HREPS */
    double best = 1e30;
    for (int r = 0; r < HREPS; r++) {
        /* Reset data to prevent drift toward zero from repeated multiply */
        for (long i = 0; i < N; i++) local[i] = (double)(rank + i);

        MPI_Barrier(MPI_COMM_WORLD);
        double t0 = MPI_Wtime();

#ifdef _OPENMP
        #pragma omp parallel for num_threads(tpr) schedule(static)
#endif
        for (long i = 0; i < N; i++) {
            double v = local[i];
            for (int q = 0; q < FLOP; q++) v = v * 0.9999990 + 1.0e-7;
            local[i] = v;
        }
        MPI_Allreduce(local, global, N, MPI_DOUBLE, MPI_SUM, MPI_COMM_WORLD);

        double elapsed = MPI_Wtime() - t0;
        double maxsec = 0.0;
        MPI_Reduce(&elapsed, &maxsec, 1, MPI_DOUBLE, MPI_MAX, 0, MPI_COMM_WORLD);
        if (rank == 0 && maxsec < best) best = maxsec;
    }

    /* Anti-elision */
    double sum = 0.0;
    for (long i = 0; i < N; i++) sum += global[i];
    if (rank == 0) {
        if (sum == 1.0e300) fprintf(stderr, "noop\n");
        printf("%.3f\n", best * 1000.0);
    }
    free(local); free(global);
}

int main(int argc, char **argv) {
    MPI_Init(&argc, &argv);
    int rank, size;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &size);

    const char *mode = (argc > 1) ? argv[1] : "strong";

    /* Dispatch new modes before the legacy strong/weak path. */
    if (strcmp(mode, "collective") == 0) {
        const char *coll_type = (argc > 2) ? argv[2] : "allreduce";
        run_collective(coll_type, rank, size);
        MPI_Finalize();
        return 0;
    }
    if (strcmp(mode, "hybrid") == 0) {
        int tpr = (argc > 2) ? atoi(argv[2]) : 4;
        if (tpr < 1) tpr = 1;
        run_hybrid(tpr, rank, size);
        MPI_Finalize();
        return 0;
    }

    /* Legacy strong/weak halo-exchange path. */
    long Nbase = (argc > 2) ? atol(argv[2]) : 400000L;
    int  iters = (argc > 3) ? atoi(argv[3]) : 30;
    if (Nbase < (long)size) Nbase = size;
    if (iters < 1) iters = 1;
    int weak = (strcmp(mode, "weak") == 0);

    /* Global problem size: fixed (strong) or growing with ranks (weak). */
    long Nglob = weak ? Nbase * (long)size : Nbase;
    long nloc  = Nglob / size;                 /* local cells on this rank */
    if (rank == size - 1) nloc += Nglob % size; /* last rank absorbs the remainder */

    /* Local array with one halo cell on each side: indices 1..nloc are owned. */
    double *u  = (double *)malloc((nloc + 2) * sizeof(double));
    double *un = (double *)malloc((nloc + 2) * sizeof(double));
    if (!u || !un) { if (rank == 0) fprintf(stderr, "alloc failed\n"); MPI_Abort(MPI_COMM_WORLD, 1); }
    for (long i = 0; i < nloc + 2; i++) u[i] = (double)((rank + i) & 1023);

    int left  = (rank - 1 + size) % size;      /* ring topology */
    int right = (rank + 1) % size;

    double t0 = 0.0;
    for (int it = 0; it < iters + 1; it++) {
        if (it == 1) { MPI_Barrier(MPI_COMM_WORLD); t0 = MPI_Wtime(); } /* it==0 is warm-up */

        /* Halo exchange: send my edge cells, receive into my halo cells. */
        MPI_Sendrecv(&u[1],    1, MPI_DOUBLE, left,  0,
                     &u[nloc + 1], 1, MPI_DOUBLE, right, 0,
                     MPI_COMM_WORLD, MPI_STATUS_IGNORE);
        MPI_Sendrecv(&u[nloc], 1, MPI_DOUBLE, right, 1,
                     &u[0],    1, MPI_DOUBLE, left,  1,
                     MPI_COMM_WORLD, MPI_STATUS_IGNORE);

        /* 3-point stencil + a short dependent arithmetic chain (compute-bound; see FLOP). */
        for (long i = 1; i <= nloc; i++) {
            double v = 0.25 * u[i - 1] + 0.5 * u[i] + 0.25 * u[i + 1];
            for (int q = 0; q < FLOP; q++) v = v * 0.9999990 + 1.0e-7;
            un[i] = v;
        }
        double *tmp = u; u = un; un = tmp;
    }
    double elapsed = MPI_Wtime() - t0;

    double maxsec = 0.0;
    MPI_Reduce(&elapsed, &maxsec, 1, MPI_DOUBLE, MPI_MAX, 0, MPI_COMM_WORLD);

    /* Touch the result so the optimiser can't elide the loop. */
    double checksum = 0.0;
    for (long i = 1; i <= nloc; i++) checksum += u[i];
    double gsum = 0.0;
    MPI_Reduce(&checksum, &gsum, 1, MPI_DOUBLE, MPI_SUM, 0, MPI_COMM_WORLD);

    if (rank == 0) {
        if (gsum == 1.0e300) fprintf(stderr, "noop\n"); /* defeat dead-code elimination */
        printf("%.3f\n", maxsec * 1000.0);              /* wall time in ms */
    }
    free(u); free(un);
    MPI_Finalize();
    return 0;
}
