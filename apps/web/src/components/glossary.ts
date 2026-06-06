// Shared HPC glossary for the <Term> hover-tooltip component. Plain-English, newcomer-first.
export const GLOSSARY: Record<string, string> = {
  thread: "A stream of execution inside one process. OpenMP threads of a team share memory.",
  rank: "An MPI process's id (0 .. size-1). Each rank is a separate program with its own memory.",
  process: "An independent running program with its own private memory.",
  barrier: "A synchronization point: no one passes until everyone has arrived.",
  race: "A data race — two threads touch the same memory and at least one writes, with no ordering, so the result is undefined.",
  reduction: "Combining every thread/rank's partial result into one (e.g. a sum) safely.",
  warp: "A group of 32 GPU threads that execute together in lockstep on an SM.",
  occupancy: "The fraction of a GPU SM's warp slots that are actually active.",
  collective: "An MPI operation involving all ranks at once (broadcast, scatter, gather, reduce, ...).",
  communicator: "A group of MPI ranks that can communicate (e.g. MPI_COMM_WORLD).",
  chunk: "A contiguous block of loop iterations handed to one thread by the scheduler.",
  "work-sharing": "An OpenMP construct (for / sections / single) that splits work among an existing team.",
  "load imbalance": "When some threads/ranks get more work than others, so the fast ones idle waiting.",
  "false sharing": "Different threads write different variables that happen to share one cache line, forcing the line to bounce between cores.",
  speedup: "How many times faster the parallel run is than one thread: T(1) / T(p).",
  efficiency: "Speedup divided by the number of threads/ranks — how well the hardware is used.",
};

export const GLOSSARY_KEYS = Object.keys(GLOSSARY);
