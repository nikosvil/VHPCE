// The /reference command library. Each entry maps to an archetype animation (archetypes.ts)
// + params, so coverage grows by adding data, not code. `exampleId` (when set) links to a
// runnable Playground example. OpenACC entries are a planned follow-up (the Tech type allows it).
import type { ArchetypeParams } from "./archetypes";

export type Tech = "OpenMP" | "MPI" | "OpenACC";

export type RefEntry = {
  id: string;
  tech: Tech;
  category: string;
  name: string;        // the directive / call as written
  signature: string;   // canonical syntax
  summary: string;     // one-sentence plain-English meaning
  note?: string;       // short "good to know" / when-to-use / gotcha
  visual: { archetype: string; params?: ArchetypeParams };
  exampleId?: string;  // a Playground example id (-> /playground?ex=...)
  related?: string[];  // other entry ids
};

export const ENTRIES: RefEntry[] = [
  /* ===================== OpenMP ===================== */
  {
    id: "omp_parallel", tech: "OpenMP", category: "Parallel regions", name: "#pragma omp parallel",
    signature: "#pragma omp parallel [clauses]\n{ /* each thread runs this */ }",
    summary: "Forks a team of threads that all run the enclosed block; they join at the end.",
    note: "By itself every thread runs the WHOLE block — add a work-sharing construct (for/sections) to split work.",
    visual: { archetype: "forkJoin", params: { threads: 6 } }, exampleId: "hello",
    related: ["omp_for", "omp_get_thread_num"],
  },
  {
    id: "omp_get_thread_num", tech: "OpenMP", category: "Parallel regions", name: "omp_get_thread_num()",
    signature: "int id = omp_get_thread_num();",
    summary: "Returns the calling thread's id within its team (0 .. num_threads-1).",
    visual: { archetype: "forkJoin", params: { threads: 6 } }, related: ["omp_get_num_threads", "omp_parallel"],
  },
  {
    id: "omp_get_num_threads", tech: "OpenMP", category: "Parallel regions", name: "omp_get_num_threads()",
    signature: "int n = omp_get_num_threads();",
    summary: "Returns how many threads are in the current team.",
    note: "Outside a parallel region it returns 1. For the max, use omp_get_max_threads().",
    visual: { archetype: "forkJoin", params: { threads: 6 } }, related: ["omp_get_thread_num"],
  },
  {
    id: "omp_set_num_threads", tech: "OpenMP", category: "Parallel regions", name: "omp_set_num_threads(n)",
    signature: "omp_set_num_threads(8);",
    summary: "Sets how many threads the next parallel region should use.",
    note: "Or set it per-region with `num_threads(n)`, or globally with the OMP_NUM_THREADS env var.",
    visual: { archetype: "forkJoin", params: { threads: 8 } }, related: ["env_omp_num_threads"],
  },
  {
    id: "env_omp_num_threads", tech: "OpenMP", category: "Parallel regions", name: "OMP_NUM_THREADS",
    signature: "export OMP_NUM_THREADS=8   # environment variable",
    summary: "Environment variable choosing the default team size — no recompile needed.",
    visual: { archetype: "forkJoin", params: { threads: 8 } }, related: ["omp_set_num_threads"],
  },
  {
    id: "omp_parallel_for", tech: "OpenMP", category: "Work-sharing", name: "#pragma omp parallel for",
    signature: "#pragma omp parallel for\nfor (i = 0; i < N; i++) work(i);",
    summary: "Shorthand for a parallel region + a for-construct: splits the loop across threads.",
    note: "The most common OpenMP line. Loop iterations must be independent.",
    visual: { archetype: "worksharing", params: { kind: "for", threads: 4 } }, exampleId: "reduction",
    related: ["omp_for", "omp_parallel"],
  },
  {
    id: "omp_for", tech: "OpenMP", category: "Work-sharing", name: "#pragma omp for",
    signature: "#pragma omp parallel\n{ #pragma omp for\n  for (...) work(i); }",
    summary: "Inside a parallel region, divides the loop's iterations among the existing team.",
    visual: { archetype: "worksharing", params: { kind: "for", threads: 4 } }, exampleId: "reduction",
    related: ["omp_parallel_for", "omp_schedule_static"],
  },
  {
    id: "omp_sections", tech: "OpenMP", category: "Work-sharing", name: "#pragma omp sections",
    signature: "#pragma omp sections\n{ #pragma omp section\n  taskA();\n  #pragma omp section\n  taskB(); }",
    summary: "Runs each independent code section once, on a different thread (functional parallelism).",
    visual: { archetype: "worksharing", params: { kind: "sections" } }, related: ["omp_for", "omp_task"],
  },
  {
    id: "omp_single", tech: "OpenMP", category: "Work-sharing", name: "#pragma omp single",
    signature: "#pragma omp single\n{ /* run by exactly one thread */ }",
    summary: "Exactly one thread (any one) runs the block; the others skip it.",
    note: "There's an implicit barrier at the end (use `nowait` to drop it).",
    visual: { archetype: "worksharing", params: { kind: "single" } }, related: ["omp_master", "omp_barrier"],
  },
  {
    id: "omp_master", tech: "OpenMP", category: "Work-sharing", name: "#pragma omp master",
    signature: "#pragma omp master\n{ /* run only by thread 0 */ }",
    summary: "Only the master thread (id 0) runs the block; no implicit barrier.",
    visual: { archetype: "worksharing", params: { kind: "master" } }, related: ["omp_single"],
  },
  {
    id: "omp_schedule_static", tech: "OpenMP", category: "Scheduling", name: "schedule(static)",
    signature: "#pragma omp for schedule(static[,chunk])",
    summary: "Splits iterations into equal contiguous chunks decided up front — lowest overhead.",
    note: "Best when every iteration costs about the same.",
    visual: { archetype: "schedule", params: { kind: "static" } }, related: ["omp_schedule_dynamic", "omp_schedule_guided"],
  },
  {
    id: "omp_schedule_dynamic", tech: "OpenMP", category: "Scheduling", name: "schedule(dynamic)",
    signature: "#pragma omp for schedule(dynamic[,chunk])",
    summary: "Threads grab small chunks on demand as they finish — balances uneven work.",
    note: "Fixes load imbalance, but the hand-out has overhead; tune the chunk size.",
    visual: { archetype: "schedule", params: { kind: "dynamic" } }, related: ["omp_schedule_static", "omp_schedule_guided"],
  },
  {
    id: "omp_schedule_guided", tech: "OpenMP", category: "Scheduling", name: "schedule(guided)",
    signature: "#pragma omp for schedule(guided[,chunk])",
    summary: "Like dynamic but chunks start large and shrink — good balance with less overhead.",
    visual: { archetype: "schedule", params: { kind: "guided" } }, related: ["omp_schedule_dynamic"],
  },
  {
    id: "omp_collapse", tech: "OpenMP", category: "Scheduling", name: "collapse(n)",
    signature: "#pragma omp for collapse(2)\nfor (i..) for (j..) work(i,j);",
    summary: "Merges n perfectly-nested loops into one larger iteration space to parallelize.",
    note: "Use when the outer loop alone has too few iterations to fill the threads.",
    visual: { archetype: "worksharing", params: { kind: "for", threads: 4 } }, related: ["omp_parallel_for"],
  },
  {
    id: "omp_barrier", tech: "OpenMP", category: "Synchronization", name: "#pragma omp barrier",
    signature: "#pragma omp barrier",
    summary: "Every thread waits here until all threads in the team arrive.",
    visual: { archetype: "barrier", params: { kind: "barrier" } }, related: ["omp_nowait", "omp_taskwait"],
  },
  {
    id: "omp_nowait", tech: "OpenMP", category: "Synchronization", name: "nowait",
    signature: "#pragma omp for nowait",
    summary: "Removes the implicit barrier at the end of a work-sharing construct.",
    note: "Speeds things up, but only safe when later code doesn't depend on all iterations finishing.",
    visual: { archetype: "barrier", params: { kind: "nowait" } }, related: ["omp_barrier"],
  },
  {
    id: "omp_critical", tech: "OpenMP", category: "Synchronization", name: "#pragma omp critical",
    signature: "#pragma omp critical\n{ /* one thread at a time */ }",
    summary: "Makes the block mutually exclusive — only one thread executes it at a time.",
    note: "Correct but slow if hot: it serializes. Prefer reduction/atomic where possible.",
    visual: { archetype: "criticalAtomic", params: { kind: "critical" } }, related: ["omp_atomic", "omp_reduction"],
  },
  {
    id: "omp_atomic", tech: "OpenMP", category: "Synchronization", name: "#pragma omp atomic",
    signature: "#pragma omp atomic\nsum += x;",
    summary: "A single memory update done atomically — cheaper than critical for one operation.",
    visual: { archetype: "criticalAtomic", params: { kind: "atomic" } }, related: ["omp_critical", "omp_reduction"],
  },
  {
    id: "omp_locks", tech: "OpenMP", category: "Synchronization", name: "omp_set_lock / omp_unset_lock",
    signature: "omp_lock_t l; omp_init_lock(&l);\nomp_set_lock(&l); /* ... */ omp_unset_lock(&l);",
    summary: "Explicit locks for fine-grained mutual exclusion when critical isn't flexible enough.",
    visual: { archetype: "criticalAtomic", params: { kind: "lock" } }, related: ["omp_critical"],
  },
  {
    id: "omp_taskwait", tech: "OpenMP", category: "Synchronization", name: "#pragma omp taskwait",
    signature: "#pragma omp taskwait",
    summary: "Waits for the child tasks spawned by the current task to complete.",
    visual: { archetype: "barrier", params: { kind: "barrier" } }, related: ["omp_task"],
  },
  {
    id: "omp_shared", tech: "OpenMP", category: "Data sharing", name: "shared(var)",
    signature: "#pragma omp parallel shared(x)",
    summary: "All threads access the SAME variable — one copy in shared memory.",
    note: "Concurrent writes to a shared variable are a data race; guard them (reduction/atomic/critical).",
    visual: { archetype: "dataSharing", params: { clause: "shared" } }, exampleId: "falsesharing",
    related: ["omp_private", "omp_reduction"],
  },
  {
    id: "omp_private", tech: "OpenMP", category: "Data sharing", name: "private(var)",
    signature: "#pragma omp parallel private(x)",
    summary: "Each thread gets its own uninitialised copy of the variable.",
    visual: { archetype: "dataSharing", params: { clause: "private" } }, related: ["omp_firstprivate", "omp_shared"],
  },
  {
    id: "omp_firstprivate", tech: "OpenMP", category: "Data sharing", name: "firstprivate(var)",
    signature: "#pragma omp parallel firstprivate(x)",
    summary: "Private copies, each initialised from the variable's value before the region.",
    visual: { archetype: "dataSharing", params: { clause: "firstprivate" } }, related: ["omp_private", "omp_lastprivate"],
  },
  {
    id: "omp_lastprivate", tech: "OpenMP", category: "Data sharing", name: "lastprivate(var)",
    signature: "#pragma omp for lastprivate(x)",
    summary: "Private copies; the value from the last loop iteration is copied back out.",
    visual: { archetype: "dataSharing", params: { clause: "lastprivate" } }, related: ["omp_firstprivate"],
  },
  {
    id: "omp_reduction", tech: "OpenMP", category: "Data sharing", name: "reduction(op:var)",
    signature: "#pragma omp parallel for reduction(+:sum)",
    summary: "Each thread keeps a private partial; OpenMP combines them with op at the end.",
    note: "The safe, fast way to accumulate (sum, max, &&, ...) — no race, scales well.",
    visual: { archetype: "reduction", params: { threads: 4 } }, exampleId: "reduction",
    related: ["omp_critical", "omp_atomic"],
  },
  {
    id: "omp_default", tech: "OpenMP", category: "Data sharing", name: "default(none)",
    signature: "#pragma omp parallel default(none) shared(...) private(...)",
    summary: "Forces you to declare the sharing of every variable — catches mistakes early.",
    note: "A great habit: with default(none) the compiler errors on anything you forgot to classify.",
    visual: { archetype: "dataSharing", params: { clause: "shared" } }, related: ["omp_shared", "omp_private"],
  },
  {
    id: "omp_task", tech: "OpenMP", category: "Tasking", name: "#pragma omp task",
    signature: "#pragma omp task\n{ /* unit of deferred work */ }",
    summary: "Creates a task that any thread can run later — great for irregular/recursive work.",
    note: "Usually created inside a single region; combine with taskwait/depend to order them.",
    visual: { archetype: "tasks" }, related: ["omp_taskloop", "omp_taskwait"],
  },
  {
    id: "omp_taskloop", tech: "OpenMP", category: "Tasking", name: "#pragma omp taskloop",
    signature: "#pragma omp taskloop\nfor (...) work(i);",
    summary: "Turns a loop into a set of tasks the team picks up (work-stealing balance).",
    visual: { archetype: "tasks" }, related: ["omp_task", "omp_schedule_dynamic"],
  },
  {
    id: "omp_depend", tech: "OpenMP", category: "Tasking", name: "depend(in/out:var)",
    signature: "#pragma omp task depend(out:a)\n#pragma omp task depend(in:a)",
    summary: "Declares data dependencies so the runtime orders tasks correctly.",
    visual: { archetype: "tasks" }, related: ["omp_task"],
  },

  /* ===================== MPI ===================== */
  {
    id: "mpi_init", tech: "MPI", category: "Setup", name: "MPI_Init / MPI_Finalize",
    signature: "MPI_Init(&argc, &argv);\n/* ... */\nMPI_Finalize();",
    summary: "Start and stop the MPI runtime; bracket every MPI program with these.",
    visual: { archetype: "ranksMemory", params: { threads: 4 } }, related: ["mpi_comm_rank", "mpi_comm_size"],
  },
  {
    id: "mpi_comm_rank", tech: "MPI", category: "Setup", name: "MPI_Comm_rank",
    signature: "int rank; MPI_Comm_rank(MPI_COMM_WORLD, &rank);",
    summary: "Gives this process its id (0 .. size-1) within a communicator.",
    note: "Branch on rank to make different processes do different things.",
    visual: { archetype: "ranksMemory", params: { threads: 4 } }, related: ["mpi_comm_size", "mpi_init"],
  },
  {
    id: "mpi_comm_size", tech: "MPI", category: "Setup", name: "MPI_Comm_size",
    signature: "int size; MPI_Comm_size(MPI_COMM_WORLD, &size);",
    summary: "Returns how many processes (ranks) are in the communicator.",
    visual: { archetype: "ranksMemory", params: { threads: 4 } }, related: ["mpi_comm_rank"],
  },
  {
    id: "mpi_comm_split", tech: "MPI", category: "Setup", name: "MPI_Comm_split",
    signature: "MPI_Comm_split(MPI_COMM_WORLD, color, key, &newcomm);",
    summary: "Partitions ranks into sub-communicators by `color` — independent groups.",
    visual: { archetype: "ranksMemory", params: { threads: 6, kind: "split" } }, related: ["mpi_comm_rank"],
  },
  {
    id: "mpi_wtime", tech: "MPI", category: "Setup", name: "MPI_Wtime",
    signature: "double t = MPI_Wtime();",
    summary: "High-resolution wall-clock seconds — wrap a region to time it.",
    note: "Pair with MPI_Reduce(MAX) to get the slowest rank's time (the true wall time).",
    visual: { archetype: "ranksMemory", params: { threads: 4 } }, related: ["mpi_reduce"],
  },
  {
    id: "mpi_send", tech: "MPI", category: "Point-to-point", name: "MPI_Send",
    signature: "MPI_Send(&x, n, MPI_INT, dest, tag, comm);",
    summary: "Sends a message to one specific rank (blocking: returns when the buffer is reusable).",
    visual: { archetype: "pointToPoint", params: { mode: "blocking" } }, related: ["mpi_recv", "mpi_isend"],
  },
  {
    id: "mpi_recv", tech: "MPI", category: "Point-to-point", name: "MPI_Recv",
    signature: "MPI_Recv(&x, n, MPI_INT, src, tag, comm, &status);",
    summary: "Receives a message from a rank (blocks until the message arrives).",
    note: "Send/Recv tags and types must match, or you'll deadlock or mis-read.",
    visual: { archetype: "pointToPoint", params: { mode: "blocking" } }, related: ["mpi_send", "mpi_sendrecv"],
  },
  {
    id: "mpi_sendrecv", tech: "MPI", category: "Point-to-point", name: "MPI_Sendrecv",
    signature: "MPI_Sendrecv(sbuf,.., dest,.., rbuf,.., src,.., comm, &st);",
    summary: "Send and receive in one call — avoids deadlock in exchanges (e.g. halo swaps).",
    visual: { archetype: "pointToPoint", params: { mode: "blocking" } }, related: ["mpi_send", "mpi_recv"],
  },
  {
    id: "mpi_isend", tech: "MPI", category: "Point-to-point", name: "MPI_Isend / MPI_Irecv",
    signature: "MPI_Isend(&x, n, .., &req);  /* ... compute ... */\nMPI_Wait(&req, &status);",
    summary: "Non-blocking: post the transfer, keep computing, then Wait — overlaps comm with compute.",
    note: "The key to hiding communication cost. Don't touch the buffer until Wait returns.",
    visual: { archetype: "pointToPoint", params: { mode: "nonblocking" } }, related: ["mpi_wait", "mpi_send"],
  },
  {
    id: "mpi_wait", tech: "MPI", category: "Point-to-point", name: "MPI_Wait / MPI_Waitall",
    signature: "MPI_Wait(&req, &status);  MPI_Waitall(n, reqs, stats);",
    summary: "Blocks until one (or all) non-blocking operations complete.",
    visual: { archetype: "pointToPoint", params: { mode: "nonblocking" } }, related: ["mpi_isend"],
  },
  {
    id: "mpi_bcast", tech: "MPI", category: "Collectives", name: "MPI_Bcast",
    signature: "MPI_Bcast(&buf, n, type, root, comm);",
    summary: "The root sends the same data to every rank in the communicator.",
    visual: { archetype: "collective", params: { op: "bcast" } }, related: ["mpi_scatter", "mpi_reduce"],
  },
  {
    id: "mpi_scatter", tech: "MPI", category: "Collectives", name: "MPI_Scatter",
    signature: "MPI_Scatter(send, n, .., recv, n, .., root, comm);",
    summary: "The root splits an array and sends one chunk to each rank.",
    visual: { archetype: "collective", params: { op: "scatter" } }, related: ["mpi_gather", "mpi_bcast"],
  },
  {
    id: "mpi_gather", tech: "MPI", category: "Collectives", name: "MPI_Gather",
    signature: "MPI_Gather(send, n, .., recv, n, .., root, comm);",
    summary: "Collects one piece from each rank into an array at the root (inverse of scatter).",
    visual: { archetype: "collective", params: { op: "gather" } }, related: ["mpi_scatter", "mpi_allgather"],
  },
  {
    id: "mpi_allgather", tech: "MPI", category: "Collectives", name: "MPI_Allgather",
    signature: "MPI_Allgather(send, n, .., recv, n, .., comm);",
    summary: "Like gather, but every rank ends up with the full collected array.",
    visual: { archetype: "collective", params: { op: "allgather" } }, related: ["mpi_gather"],
  },
  {
    id: "mpi_reduce", tech: "MPI", category: "Collectives", name: "MPI_Reduce",
    signature: "MPI_Reduce(send, recv, n, type, MPI_SUM, root, comm);",
    summary: "Combines values from all ranks with an op (sum, max, ...) into the root.",
    visual: { archetype: "collective", params: { op: "reduce" } }, related: ["mpi_allreduce", "mpi_gather"],
  },
  {
    id: "mpi_allreduce", tech: "MPI", category: "Collectives", name: "MPI_Allreduce",
    signature: "MPI_Allreduce(send, recv, n, type, MPI_SUM, comm);",
    summary: "Reduce, then give the result to every rank — extremely common (e.g. global sums).",
    visual: { archetype: "collective", params: { op: "allreduce" } }, related: ["mpi_reduce"],
  },
  {
    id: "mpi_alltoall", tech: "MPI", category: "Collectives", name: "MPI_Alltoall",
    signature: "MPI_Alltoall(send, n, .., recv, n, .., comm);",
    summary: "Every rank sends a distinct chunk to every other rank — a full transpose of data.",
    note: "The most communication-heavy collective; can dominate at scale (e.g. FFTs).",
    visual: { archetype: "collective", params: { op: "alltoall" } }, related: ["mpi_allgather"],
  },
  {
    id: "mpi_barrier", tech: "MPI", category: "Collectives", name: "MPI_Barrier",
    signature: "MPI_Barrier(comm);",
    summary: "No rank proceeds until all ranks in the communicator have reached the barrier.",
    visual: { archetype: "collective", params: { op: "barrier" } }, related: ["omp_barrier"],
  },
];

export const TECHS: Tech[] = ["OpenMP", "MPI"];
export const categoriesFor = (tech: Tech) =>
  Array.from(new Set(ENTRIES.filter((e) => e.tech === tech).map((e) => e.category)));
