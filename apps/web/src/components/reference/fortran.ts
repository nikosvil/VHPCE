// Derives a Fortran form of a C/C++ reference signature, so each entry can show both
// languages. Heuristic but accurate for the common shapes: OpenMP/OpenACC sentinel swap
// (#pragma omp -> !$omp, for -> do, + the paired `end` directive for block constructs);
// MPI calls -> `call NAME(..., ierror)` with Fortran type names. Entries may override with
// an explicit `signatureF`.
import type { Tech } from "./entries";

const MPI_TYPES: Record<string, string> = {
  MPI_INT: "MPI_INTEGER", MPI_DOUBLE: "MPI_DOUBLE_PRECISION", MPI_FLOAT: "MPI_REAL",
  MPI_CHAR: "MPI_CHARACTER", MPI_LONG: "MPI_INTEGER8", MPI_PACKED: "MPI_PACKED",
};

// block constructs that take a paired end directive (construct head -> end name)
const OMP_END: Record<string, string> = {
  "parallel do simd": "parallel do simd", "parallel do": "parallel do", "parallel sections": "parallel sections",
  "target teams distribute": "target teams distribute", "target teams": "target teams", "target data": "target data",
  "teams distribute": "teams distribute", parallel: "parallel", target: "target", teams: "teams",
  distribute: "distribute", sections: "sections", single: "single", master: "master", masked: "masked",
  task: "task", taskgroup: "taskgroup", critical: "critical", ordered: "ordered", scope: "scope",
  workshare: "workshare", simd: "simd", do: "do",
};
const ACC_END: Record<string, string> = {
  "parallel loop": "parallel loop", parallel: "parallel", kernels: "kernels", data: "data", serial: "serial",
};

function endName(dir: string, ends: Record<string, string>): string | null {
  const head = dir.split("(")[0].trim();
  // Standalone executable directives that take NO paired `end` — they'd otherwise be caught
  // by the "target " prefix of the block-construct key below and emit a bogus `end target`.
  if (/^target (enter data|exit data|update)\b/.test(head)) return null;
  for (const k of Object.keys(ends).sort((a, b) => b.length - a.length)) {
    if (head === k || head.startsWith(k + " ")) return ends[k];
  }
  return null;
}

const decomment = (line: string) =>
  line.replace(/^(\s*)\/\/\s?/, "$1! ").replace(/^(\s*)\/\*\s?/, "$1! ").replace(/\s*\*\/\s*$/, "").replace(/^(\s*)\*\s?/, "$1! ");

export function toFortran(sig: string, tech: Tech): string {
  if (tech === "MPI") {
    return sig.split("\n").map((line) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return decomment(line);
      let l = line.replace(/&/g, "");
      for (const [c, f] of Object.entries(MPI_TYPES)) l = l.replace(new RegExp("\\b" + c + "\\b", "g"), f);
      const m = l.match(/\b(MPI_[A-Za-z_]+)\s*\(([\s\S]*)\)\s*;?\s*$/);
      if (m && m[1] !== "MPI_IN_PLACE") {
        const inside = m[2].trim();
        return `call ${m[1]}(${inside}${inside ? ", " : ""}ierror)`;
      }
      return l.replace(/;\s*$/, "");
    }).join("\n");
  }
  const sent = tech === "OpenACC" ? "!$acc" : "!$omp";
  const ends = tech === "OpenACC" ? ACC_END : OMP_END;
  let pendingEnd: string | null = null;
  const out: string[] = [];
  for (const line of sig.split("\n")) {
    const pm = line.match(/^\s*#pragma\s+(?:omp|acc)\s+(.*)$/);
    if (pm) {
      const dir = pm[1].replace(/\bparallel for\b/g, "parallel do").replace(/\bfor\b/g, "do");
      out.push(`${sent} ${dir}`);
      if (pendingEnd === null) pendingEnd = endName(dir, ends);
      continue;
    }
    if (/^\s*[{}]\s*$/.test(line)) continue;
    const fm = line.match(/for\s*\(\s*(?:\w[\w ]*\s+)?(\w+)\s*=\s*([^;]+);\s*\1\s*<\s*([^;]+);/);
    if (fm) { out.push(`${line.match(/^\s*/)?.[0] ?? ""}do ${fm[1]} = ${fm[2].trim()}, (${fm[3].trim()}) - 1`); continue; }
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) { out.push(decomment(line)); continue; }
    out.push(line.replace(/;\s*$/, ""));
  }
  if (pendingEnd) out.push(`${sent} end ${pendingEnd}`);
  return out.join("\n");
}
