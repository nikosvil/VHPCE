"""Generate the VHPCE whitepaper PDF."""
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, HRFlowable,
)
from reportlab.lib import colors

OUT = os.environ.get("VHPCE_PDF_OUT", os.path.join(os.path.dirname(__file__) or ".", "VHPCE_Whitepaper.pdf"))

DARK = HexColor("#1a1a2e")
ACCENT = HexColor("#0f7173")
LIGHT_BG = HexColor("#f0f4f8")
HEADER_BG = HexColor("#0f7173")
HEADER_FG = colors.white

styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    "WPTitle", parent=styles["Title"], fontSize=26, leading=32,
    textColor=DARK, alignment=TA_CENTER, spaceAfter=6,
))
styles.add(ParagraphStyle(
    "WPSubtitle", parent=styles["Normal"], fontSize=13, leading=17,
    textColor=HexColor("#555555"), alignment=TA_CENTER, spaceAfter=24,
))
styles.add(ParagraphStyle(
    "WPAuthor", parent=styles["Normal"], fontSize=11, leading=14,
    textColor=HexColor("#333333"), alignment=TA_CENTER, spaceAfter=4,
))
styles.add(ParagraphStyle(
    "WPDate", parent=styles["Normal"], fontSize=10, leading=13,
    textColor=HexColor("#777777"), alignment=TA_CENTER, spaceAfter=36,
))
styles.add(ParagraphStyle(
    "SectionHead", parent=styles["Heading1"], fontSize=16, leading=20,
    textColor=DARK, spaceBefore=24, spaceAfter=10,
    borderWidth=0, borderPadding=0,
))
styles.add(ParagraphStyle(
    "SubHead", parent=styles["Heading2"], fontSize=13, leading=16,
    textColor=ACCENT, spaceBefore=14, spaceAfter=6,
))
styles.add(ParagraphStyle(
    "SubSubHead", parent=styles["Heading3"], fontSize=11, leading=14,
    textColor=HexColor("#333333"), spaceBefore=10, spaceAfter=4,
))
styles.add(ParagraphStyle(
    "Body", parent=styles["Normal"], fontSize=10, leading=14,
    alignment=TA_JUSTIFY, spaceAfter=8,
))
styles.add(ParagraphStyle(
    "BodyIndent", parent=styles["Normal"], fontSize=10, leading=14,
    alignment=TA_JUSTIFY, spaceAfter=6, leftIndent=18,
))
styles.add(ParagraphStyle(
    "WPBullet", parent=styles["Normal"], fontSize=10, leading=14,
    leftIndent=24, bulletIndent=12, spaceAfter=4,
))
styles.add(ParagraphStyle(
    "Caption", parent=styles["Normal"], fontSize=9, leading=12,
    textColor=HexColor("#555555"), alignment=TA_CENTER, spaceAfter=12,
    spaceBefore=4,
))
styles.add(ParagraphStyle(
    "WPCode", parent=styles["Normal"], fontName="Courier", fontSize=8.5,
    leading=11, leftIndent=12, spaceAfter=8, spaceBefore=4,
    backColor=HexColor("#f5f5f5"),
))
styles.add(ParagraphStyle(
    "AbstractBody", parent=styles["Normal"], fontSize=10, leading=14,
    alignment=TA_JUSTIFY, spaceAfter=8, leftIndent=36, rightIndent=36,
))
styles.add(ParagraphStyle(
    "FooterStyle", parent=styles["Normal"], fontSize=8, leading=10,
    textColor=HexColor("#999999"), alignment=TA_CENTER,
))

S = styles

def sec(title):
    return Paragraph(title, S["SectionHead"])

def sub(title):
    return Paragraph(title, S["SubHead"])

def subsub(title):
    return Paragraph(title, S["SubSubHead"])

def body(text):
    return Paragraph(text, S["Body"])

def bullet(text):
    return Paragraph(f"•  {text}", S["WPBullet"])

def code(text):
    return Paragraph(text.replace("\n", "<br/>"), S["WPCode"])

def sp(h=6):
    return Spacer(1, h)

def hr():
    return HRFlowable(width="80%", thickness=0.5, color=HexColor("#cccccc"),
                       spaceBefore=8, spaceAfter=8)

def make_table(headers, rows, col_widths=None):
    data = [headers] + rows
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), HEADER_FG),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("LEADING", (0, 0), (-1, -1), 12),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#cccccc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def build():
    doc = SimpleDocTemplate(
        OUT, pagesize=letter,
        topMargin=0.8*inch, bottomMargin=0.8*inch,
        leftMargin=0.9*inch, rightMargin=0.9*inch,
        title="VHPCE: Visual HPC for Engineering Students",
        author="Nikos Vilardos",
        subject="Whitepaper",
    )
    story = []

    # ── TITLE PAGE ──
    story.append(sp(80))
    story.append(Paragraph(
        "Visual HPC for Engineering Students", S["WPTitle"]
    ))
    story.append(Paragraph("(VHPCE)", S["WPSubtitle"]))
    story.append(sp(8))
    story.append(Paragraph(
        "An Interactive Performance Laboratory for Teaching<br/>"
        "High-Performance Computing through Experimentation",
        S["WPSubtitle"],
    ))
    story.append(sp(24))
    story.append(Paragraph("Nikos Vilardos", S["WPAuthor"]))
    story.append(Paragraph("nikosvil@gmail.com", S["WPAuthor"]))
    story.append(sp(12))
    story.append(Paragraph("June 2026", S["WPDate"]))
    story.append(sp(24))
    story.append(hr())
    story.append(sp(8))
    story.append(Paragraph(
        "<b>Abstract</b>", ParagraphStyle("AbsHead", parent=S["Body"],
        fontSize=11, alignment=TA_CENTER, spaceAfter=8)
    ))
    story.append(Paragraph(
        "Teaching High-Performance Computing (HPC) to engineering students presents a "
        "persistent challenge: the gap between textbook theory and the reality of hardware "
        "behavior. Students learn Amdahl's law and cache hierarchies in lecture, but rarely "
        "get to observe these phenomena on real silicon. VHPCE bridges this gap with an "
        "interactive, browser-based performance laboratory where students edit code, run "
        "experiments, watch hardware behavior animate in real time, and receive plain-English "
        "explanations of why performance changes. The platform covers OpenMP, MPI, OpenACC, "
        "and CUDA through sixteen flagship experiments, a 228-entry command reference, "
        "engineering domain simulation labs, a live code playground with Docker-sandboxed "
        "execution, and a gamification layer. A central architectural idea—the "
        "<i>ProfileResult</i> seam—lets every experiment run in two interchangeable "
        "modes: a physics-based model (offline, instant) and measured runs on the student's "
        "own CPU/GPU via Docker. This paper presents the system architecture, pedagogical "
        "design, implementation details, and deployment model.",
        S["AbstractBody"],
    ))
    story.append(sp(12))
    story.append(Paragraph(
        "<b>Keywords:</b> HPC education, parallel computing, interactive visualization, "
        "performance modeling, OpenMP, MPI, CUDA, Docker sandboxing",
        ParagraphStyle("KW", parent=S["Body"], fontSize=9, alignment=TA_CENTER,
                       textColor=HexColor("#555555")),
    ))
    story.append(PageBreak())

    # ── TABLE OF CONTENTS ──
    story.append(Paragraph("Table of Contents", S["SectionHead"]))
    story.append(sp(8))
    toc_items = [
        ("1.", "Introduction", "3"),
        ("2.", "System Architecture", "4"),
        ("3.", "Pedagogical Design", "6"),
        ("4.", "The Experiment Engine", "8"),
        ("5.", "Interactive Components", "10"),
        ("6.", "Execution Backend", "12"),
        ("7.", "AI-Powered Explanation Layer", "14"),
        ("8.", "Deployment Model", "15"),
        ("9.", "Future Work", "16"),
        ("10.", "Conclusion", "17"),
    ]
    for num, title, pg in toc_items:
        story.append(Paragraph(
            f"<b>{num}</b>&nbsp;&nbsp;{title}"
            f"{'&nbsp;' * 4}<font color='#999999'>{'.' * (55 - len(title))}</font>"
            f"&nbsp;{pg}",
            ParagraphStyle("TOC", parent=S["Body"], fontSize=11, leading=18, spaceAfter=2),
        ))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 1  INTRODUCTION
    # ════════════════════════════════════════════════════════════════
    story.append(sec("1. Introduction"))
    story.append(body(
        "High-Performance Computing underpins modern science and engineering—from climate "
        "modeling and computational fluid dynamics to molecular simulation and machine learning "
        "training. Yet teaching HPC remains difficult. The core challenge is not syntax "
        "(students can learn <font face='Courier'>#pragma omp parallel for</font> in an "
        "afternoon) but <b>performance intuition</b>: understanding <i>why</i> adding more "
        "threads sometimes makes code slower, why memory access patterns matter more than "
        "instruction counts, and why the gap between a textbook formula and real hardware can "
        "be enormous."
    ))
    story.append(body(
        "Existing approaches fall into two camps. Lecture-based courses cover Amdahl's law, "
        "cache hierarchies, and communication overhead in theory, but students never observe "
        "these phenomena on real hardware. Lab-based courses run code on clusters, but the "
        "turnaround time between editing and insight is long, the infrastructure is fragile, "
        "and students often cannot distinguish a code bug from a hardware effect."
    ))
    story.append(body(
        "VHPCE—<b>Visual HPC for Engineering Students</b>—is an interactive, "
        "browser-based performance laboratory that attacks this gap head-on. Its design "
        "philosophy can be summarized in one phrase: <b>performance intuition over syntax "
        "memorization</b>. Students don't just write parallel code; they <i>predict</i> its "
        "behavior, <i>observe</i> what actually happens (via animated visualizations and "
        "scaling charts), and <i>read</i> a deterministic, plain-English diagnosis explaining "
        "the discrepancy. The platform covers the full HPC stack—OpenMP, MPI, OpenACC, "
        "and CUDA—through a unified interface."
    ))

    story.append(sub("1.1 Key Contributions"))
    contribs = [
        "<b>The ProfileResult seam.</b> A single data contract that decouples data "
        "producers (physics models and real hardware measurements) from consumers "
        "(visualizations, charts, and explanations). This lets the platform ship a fully "
        "functional offline experience on day one and upgrade to real measurements later "
        "without changing any downstream code.",
        "<b>Predict-before-you-run pedagogy.</b> Every experiment asks the student to guess "
        "the speedup before running, grounding the learning cycle in active recall rather "
        "than passive observation.",
        "<b>Model and Measured duality.</b> Every experiment supports two interchangeable "
        "data sources: an instant physics model (runs in the browser, no backend needed) and "
        "measured runs on the student's own CPU or GPU via Docker containers.",
        "<b>Sixteen flagship experiments</b> covering the most common and counter-intuitive "
        "performance bottlenecks in parallel programming, each with 2D Canvas visualization, "
        "scaling charts, and deterministic diagnostics.",
        "<b>A locked-down code playground</b> where students compile and run arbitrary "
        "OpenMP C in Docker containers with network isolation, capability dropping, "
        "memory/PID limits, and read-only filesystems.",
        "<b>A dual AI explanation layer</b>—always-on deterministic rules grounded in "
        "the physics models, plus an optional LLM panel for open-ended follow-up questions.",
    ]
    for c in contribs:
        story.append(bullet(c))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 2  SYSTEM ARCHITECTURE
    # ════════════════════════════════════════════════════════════════
    story.append(sec("2. System Architecture"))
    story.append(body(
        "VHPCE is built as a TypeScript/Python monorepo with a clear separation between data "
        "production, data contracts, and data consumption. The central architectural insight "
        "is that a single schema—the <b>ProfileResult</b>—serves as the interface "
        "between everything that generates performance data and everything that renders or "
        "explains it."
    ))

    story.append(sub("2.1 The ProfileResult Seam"))
    story.append(body(
        "The <font face='Courier'>ProfileResult</font> is a JSON schema (with generated "
        "TypeScript types, Zod validators, and a mirrored Pydantic model) that describes "
        "the output of any performance experiment. It includes timing data, scaling sweeps, "
        "roofline parameters, hardware counters, thread timelines, MPI communication events, "
        "GPU occupancy metrics, and pre-computed diagnostic codes. The schema is versioned "
        "and self-describing: every numeric field carries its unit in the field name "
        "(<font face='Courier'>_gbps</font>, <font face='Courier'>_ns</font>, "
        "<font face='Courier'>_gflops</font>)."
    ))
    story.append(body(
        "Two producers feed this schema. <b>Producer A</b> (<font face='Courier'>"
        "@vhpce/perf-models</font>) runs entirely in the browser: it computes "
        "physics-based performance curves using Amdahl's law, roofline analysis, bandwidth "
        "saturation models, and coherence-cost formulas. <b>Producer B</b> (the FastAPI "
        "gateway) compiles and runs real OpenMP, MPI, and CUDA kernels in Docker containers "
        "on the student's own hardware and returns measured <font face='Courier'>"
        "ProfileResult</font>s. Because the schema is producer-agnostic, all downstream "
        "consumers—visualizations, charts, explanations—work identically with "
        "either source."
    ))

    story.append(sub("2.2 Monorepo Structure"))
    story.append(body(
        "The repository uses pnpm workspaces with Turborepo for task graph caching. "
        "The key packages are:"
    ))
    story.append(make_table(
        ["Package", "Role"],
        [
            ["apps/web", "Next.js 16 / React 19 / Tailwind v4 web application"],
            ["packages/profile-schema", "The ProfileResult seam: types, Zod validators, formatters"],
            ["packages/perf-models", "Producer A: physics models + measured data adapters"],
            ["packages/explain", "Deterministic explanation engine (rule-based diagnostics)"],
            ["packages/viz", "D3 charts (scaling, roofline, occupancy) + Canvas 2D scenes"],
            ["services/api", "FastAPI gateway + Redis/Arq job queue (Producer B)"],
            ["services/runner/experiments", "C/CUDA kernels: bench.c, halo.c, occupancy.cu"],
            ["infra/docker", "Dockerfiles and compose for sandboxed execution"],
        ],
        col_widths=[2.2*inch, 4.3*inch],
    ))

    story.append(sub("2.3 Tech Stack"))
    story.append(body(
        "The frontend is built with <b>Next.js 16</b> (App Router) and <b>React 19</b> with "
        "Tailwind CSS v4 for styling. 3D visualizations use <b>React Three Fiber</b> (Three.js) "
        "with a WebGL2 fallback. 2D charts use <b>D3</b> for scaling curves, roofline plots, "
        "and occupancy charts. The code editor is <b>Monaco</b> (the VSCode engine). The "
        "backend gateway is <b>FastAPI</b> (Python 3.12+) with <b>Redis</b> for caching and "
        "<b>Arq</b> for async job queuing. The optional AI panel uses the <b>Anthropic Claude</b> "
        "SDK with streaming and prompt caching."
    ))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 3  PEDAGOGICAL DESIGN
    # ════════════════════════════════════════════════════════════════
    story.append(sec("3. Pedagogical Design"))
    story.append(body(
        "VHPCE's pedagogical approach is built on three principles: <b>active prediction</b> "
        "over passive observation, <b>immediate visual feedback</b> over deferred analysis, "
        "and <b>progressive depth</b> from conceptual understanding to hardware-level insight."
    ))

    story.append(sub("3.1 The Learning Journey"))
    story.append(body(
        "The platform defines a guided path through eleven interconnected pages, designed to "
        "take a student from \"what is parallelism\" to \"why doesn't my code scale\":"
    ))
    journey = [
        ("<b>Introduction</b> (<font face='Courier'>/intro</font>) — The front door. "
         "Explains the model-vs-measured idea and provides a map of every section with "
         "estimated time investment."),
        ("<b>Start Here</b> (<font face='Courier'>/start</font>) — Three live runs "
         "that teach the whole story in five minutes: parallel works, the naïve version "
         "doesn't scale (a synchronization bottleneck), and the one-line fix (reduction) does. "
         "Each step is a <i>predict-before-you-run</i>: students guess the speedup before "
         "hitting Run."),
        ("<b>Learn the Basics</b> (<font face='Courier'>/learn</font>) — Six animated "
         "concept walkthroughs covering fork-join, parallel-for loop splitting, shared vs. "
         "private memory, MPI ranks and separate memory, point-to-point communication, "
         "and collective operations."),
        ("<b>Command Reference</b> (<font face='Courier'>/reference</font>) — A "
         "searchable library of ~228 directives across OpenMP, MPI, OpenACC, CUDA, Slurm, and pthreads, "
         "each with a looping Canvas animation, plain-English summary, C/Fortran toggle, "
         "and links to runnable examples."),
        ("<b>Domain Labs</b> (<font face='Courier'>/modules</font>) — Engineering "
         "simulation mini-labs (Wave/FDTD, N-Body Gravity, GEMM) showing how the same "
         "computation maps to serial, OpenMP, MPI, and GPU code."),
        ("<b>Heat Lab</b> (<font face='Courier'>/lab</font>) — A 2D heat-equation "
         "solver with domain-decomposition overlays and a live convergence plot."),
        ("<b>Flagship</b> (<font face='Courier'>/</font>) — Sixteen experiments "
         "covering every major parallel performance bottleneck."),
        ("<b>Compare</b> (<font face='Courier'>/compare</font>) — The textbook model "
         "overlaid on real measurements, highlighting where theory and hardware agree "
         "and diverge."),
        ("<b>Code Playground</b> (<font face='Courier'>/playground</font>) — Write "
         "arbitrary OpenMP C, predict the speedup, compile and run in a sandboxed container."),
        ("<b>Play</b> (<font face='Courier'>/play</font>) — Gamified activities: "
         "Race (head-to-head kernel comparison), Quiz, Sandbox (Amdahl/Gustafson explorer), "
         "Kernel Tuner, and Badges."),
    ]
    for j in journey:
        story.append(bullet(j))

    story.append(sub("3.2 Predict-Before-You-Run"))
    story.append(body(
        "Research in active learning consistently shows that prediction followed by feedback "
        "produces stronger retention than observation alone. VHPCE embeds this throughout: "
        "in Start Here, the Playground, and the Flagship experiments, students are asked to "
        "guess the speedup or identify the bottleneck <i>before</i> seeing the result. "
        "Correct predictions earn badges and streaks; incorrect ones route to the specific "
        "experiment or explanation that addresses the misconception."
    ))

    story.append(sub("3.3 Model vs. Measured"))
    story.append(body(
        "The Model/Measured toggle is not just a convenience—it is itself a teaching "
        "tool. The model shows the textbook-clean version of each phenomenon: perfect Amdahl "
        "curves, ideal bandwidth saturation, clean communication walls. The measured run shows "
        "reality on the student's machine: noise, oversubscription effects, hardware quirks. "
        "The <i>Compare</i> page overlays both, making the gap between theory and practice "
        "the explicit object of study."
    ))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 4  THE EXPERIMENT ENGINE
    # ════════════════════════════════════════════════════════════════
    story.append(sec("4. The Experiment Engine"))
    story.append(body(
        "The Flagship page hosts sixteen experiments, each built on a documented physics model "
        "with no arbitrary constants. Every experiment follows a shared layout: controls "
        "(threads/ranks slider, variant toggles), a 2D Canvas visualization, a D3 scaling chart, "
        "and a structured what/why/how/expected diagnosis."
    ))

    story.append(sub("4.1 Original Nine Experiments"))
    exps_orig = [
        ["False Sharing", "Cache-line coherence ping-pong", "Threads", "OpenMP"],
        ["Synchronization", "Critical section serialization vs. reduction", "Threads", "OpenMP"],
        ["Bandwidth Saturation", "DRAM bus saturation + roofline", "Threads", "OpenMP"],
        ["Load Imbalance", "Static vs. dynamic scheduling", "Threads", "OpenMP"],
        ["MPI Halo Exchange", "Strong vs. weak scaling, comm fraction", "Ranks", "MPI"],
        ["GPU Occupancy", "Register pressure, threads/block sweep", "Block size", "CUDA"],
        ["GPU Coalescing", "Stride sweep, memory transactions", "Stride", "CUDA"],
        ["GPU Divergence", "Branch-path sweep, warp serialization", "Paths", "CUDA"],
        ["GPU Atomics", "Concurrent-target sweep, contention", "Targets", "CUDA"],
    ]
    story.append(make_table(
        ["Experiment", "Core Lesson", "Sweep Axis", "Tech"],
        exps_orig,
        col_widths=[1.5*inch, 2.6*inch, 1.0*inch, 0.8*inch],
    ))
    story.append(sp(6))

    story.append(sub("4.2 Seven Additional Experiments"))
    story.append(body(
        "Seven additional experiments extend coverage to advanced topics. All have both "
        "Model and Measured backends — real kernels run in Docker containers on the "
        "student's hardware:"
    ))
    exps_new = [
        ["NUMA Effects", "Socket locality, first-touch policy"],
        ["Cache Hierarchy", "L1/L2/L3/DRAM bandwidth cliffs"],
        ["SIMD Vectorization", "SIMD lanes, AoS vs. SoA, AVX"],
        ["OpenMP Tasks", "Irregular task-graph parallelism"],
        ["GPU Shared Memory", "Bank conflicts, 32 banks, padding"],
        ["MPI Collectives", "Broadcast/allreduce/alltoall algorithms"],
        ["Hybrid MPI+OMP", "Ranks × threads, NUMA sweet spot"],
    ]
    story.append(make_table(
        ["Experiment", "Core Lesson"],
        exps_new,
        col_widths=[1.8*inch, 4.0*inch],
    ))

    story.append(sub("4.3 Physics Models"))
    story.append(body(
        "Every curve displayed in Model mode is derived from a documented formula. The key "
        "models include:"
    ))
    models = [
        "<b>Amdahl's Law:</b> S(p) = 1 / ((1 − f) + f/p). Drives the speedup ceiling "
        "for every experiment. Gustafson's law (S(p) = p − α(p − 1)) is used "
        "for weak-scaling views.",
        "<b>Roofline:</b> P<sub>attainable</sub>(AI) = min(P<sub>peak</sub>, AI × "
        "BW<sub>peak</sub>). Classifies kernels as memory-bound or compute-bound.",
        "<b>False Sharing:</b> T(p) = T<sub>compute</sub>(p) + T<sub>coherence</sub>(p), "
        "where coherence cost scales as (p − 1)/p for shared cache lines.",
        "<b>Bandwidth Saturation:</b> BW<sub>eff</sub>(p) = BW<sub>peak</sub> × "
        "p / (p + p<sub>half</sub>). Models the saturating throughput curve.",
        "<b>Load Imbalance:</b> T(p) = max<sub>t</sub>(work<sub>t</sub>). "
        "Static scheduling on a triangular loop yields I ≈ 2; dynamic drives I → 1.",
    ]
    for m in models:
        story.append(bullet(m))
    story.append(body(
        "All models are parameterized by a named reference machine profile (cores, cache "
        "sizes, peak bandwidth, peak compute) so curves are concrete and reproducible. "
        "Unit tests assert analytic limits (e.g., S(1) = 1, S(∞) = 1/(1−f))."
    ))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 5  INTERACTIVE COMPONENTS
    # ════════════════════════════════════════════════════════════════
    story.append(sec("5. Interactive Components"))

    story.append(sub("5.1 Command Reference Library"))
    story.append(body(
        "The Reference page (<font face='Courier'>/reference</font>) is a searchable, "
        "filterable library of approximately 228 directives and API calls across six "
        "technologies: OpenMP (72 entries), MPI (59), OpenACC (27), CUDA (24), Slurm, "
        "and pthreads. The design is <b>archetype-driven</b>: 14 reusable Canvas animation "
        "archetypes (fork-join, barrier, reduction, scatter/gather, offload, etc.) are defined "
        "in code, and each entry maps to an archetype plus parameters. Adding a new entry "
        "requires only adding data to a table, not writing animation code."
    ))
    story.append(body(
        "Each entry includes: a looping Canvas animation showing the directive's behavior, "
        "a C/Fortran syntax toggle (derived automatically with manual overrides), a "
        "plain-English summary and \"good to know\" note with hover-glossary terms, related "
        "links (cross-technology navigation resets the filter), and a "
        "\"▶ Run in the Playground\" link where applicable. An Essentials filter "
        "(★) narrows the library to must-knows for beginners, including 11 CUDA "
        "essentials."
    ))

    story.append(sub("5.2 Domain Simulation Labs"))
    story.append(body(
        "The Domain Labs hub (<font face='Courier'>/modules</font>) hosts six "
        "engineering simulation mini-labs, each with tab-based navigation, a live Canvas "
        "animation loop, and domain-decomposition code snippets showing how the same "
        "computation maps to serial, OpenMP, MPI, and GPU implementations:"
    ))
    labs = [
        "<b>Wave Lab (FDTD)</b> — A 1D finite-difference time-domain wave solver on "
        "a 256-cell grid with reflective/absorptive boundary controls. The animation shows "
        "wave propagation; code snippets show <font face='Courier'>omp parallel for</font>, "
        "<font face='Courier'>MPI_Sendrecv</font> ghost exchange, and a CUDA kernel.",
        "<b>N-Body Gravity</b> — A 32-particle gravitational simulation using "
        "a Barnes–Hut O(N log N) approximation. Animated particle field with code "
        "snippets for OpenMP force loops, MPI particle broadcast, and CUDA thread mapping.",
        "<b>Matrix Multiply (GEMM)</b> — C = A × B on 8×8 visualization "
        "grids. Naïve mode animates the stride-N column access pattern (B column = cache "
        "miss); tiled mode shows NB×NB blocking with cache-resident tiles. An arithmetic "
        "intensity readout color-codes the kernel (red &lt; 1, amber 1–4, green &gt; 4 = "
        "ridge point).",
        "<b>FFT (Cooley-Tukey)</b> — Radix-2 butterfly diagram animation showing "
        "log2(N) sequential stages with N/2 parallel butterflies per stage. Time-domain "
        "signal and frequency-domain spectrum displayed side by side. Teaches communication "
        "patterns: MPI FFT requires XOR-partner exchanges; GPU FFT needs one kernel per stage.",
        "<b>Sparse SpMV</b> — CSR sparse matrix-vector multiply with three sparsity "
        "patterns: banded (5-point stencil, balanced), random (moderate variation), and "
        "power-law (severe imbalance). Animated row-by-row processing with access lines "
        "and a per-worker nnz bar chart exposing load imbalance — the central challenge "
        "of real-world scientific computing.",
        "<b>Multigrid V-Cycle</b> — Visualizes why Jacobi iteration stalls (only "
        "kills high-frequency error) and how the multigrid V-cycle fixes it by restricting "
        "the residual to coarser grids where low-frequency error becomes high-frequency. "
        "Convergence plot shows O(N) multigrid vs O(N<super>2</super>) Jacobi.",
    ]
    for l in labs:
        story.append(bullet(l))
    story.append(body(
        "The hub also links to the Heat Lab (<font face='Courier'>/lab</font>), a 2D "
        "heat-equation solver with domain-decomposition overlays (serial/OpenMP/MPI/GPU) and "
        "a live convergence plot showing the stability cliff at α > 0.25."
    ))

    story.append(sub("5.3 Code Playground"))
    story.append(body(
        "The Playground (<font face='Courier'>/playground</font>) provides a Monaco code "
        "editor where students write arbitrary OpenMP C, predict the speedup, then compile "
        "and run a thread-count sweep in a sandboxed Docker container. It ships with eleven "
        "worked examples (deep-linkable via <font face='Courier'>?ex=&lt;id&gt;</font>). "
        "Results include: a scaling chart, plain-language diagnostics that route the student "
        "to the specific Flagship experiment explaining their bottleneck, a per-thread-count "
        "breakdown explorer, and optional Valgrind cachegrind profiling showing D1/LLd cache "
        "miss rates."
    ))

    story.append(sub("5.4 Play Hub"))
    story.append(body(
        "The Play page (<font face='Courier'>/play</font>) is the gamified layer, designed "
        "to reinforce learning through engagement:"
    ))
    games = [
        "<b>Race</b> — Two kernel variants run head-to-head; students predict "
        "which is faster before seeing the result.",
        "<b>Quiz</b> — A bottleneck identification challenge: given a scaling curve "
        "and context, students name the performance pathology.",
        "<b>Sandbox</b> — An interactive explorer for Amdahl's and Gustafson's laws "
        "with parameter sliders.",
        "<b>Kernel Tuner</b> — Students adjust GPU launch parameters (threads/block, "
        "tile size, registers) and see how they shift occupancy and arithmetic intensity.",
        "<b>Badges</b> — A reward system earned by correct predictions across "
        "Start, Playground, and Flagship experiments, with streak tracking.",
    ]
    for g in games:
        story.append(bullet(g))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 6  EXECUTION BACKEND
    # ════════════════════════════════════════════════════════════════
    story.append(sec("6. Execution Backend"))
    story.append(body(
        "The execution backend enables Measured mode and the Code Playground. It is entirely "
        "optional—Model mode runs fully offline in the browser."
    ))

    story.append(sub("6.1 Gateway Architecture"))
    story.append(body(
        "The gateway (<font face='Courier'>services/api</font>) is a FastAPI application "
        "fronting a Redis-backed Arq job queue. The web app submits jobs via "
        "<font face='Courier'>POST /api/jobs</font> and polls results via "
        "<font face='Courier'>GET /api/jobs/{'{'}id{'}'}</font>. The Arq worker processes "
        "one job at a time (<font face='Courier'>max_jobs=1</font>) to ensure clean timing "
        "without interference from concurrent workloads. Four job kinds are supported: "
        "<font face='Courier'>bench</font> (fixed flagship kernels), "
        "<font face='Courier'>code</font> (arbitrary user code), "
        "<font face='Courier'>mpi</font> (rank sweeps), and "
        "<font face='Courier'>cuda</font> (GPU experiments). Fixed-kernel results are cached "
        "in Redis (~24h) so repeated requests return instantly."
    ))

    story.append(sub("6.2 Docker Sandboxing"))
    story.append(body(
        "All code execution happens in sibling Docker containers spawned by the worker. "
        "The worker mounts the host Docker socket and issues <font face='Courier'>"
        "docker run</font> commands. Four container images handle the different workloads:"
    ))
    story.append(make_table(
        ["Image", "Contents", "Security"],
        [
            ["vhpce-bench", "Pre-compiled OpenMP kernels (-O2 -fopenmp -march=native)",
             "Read-only, no network, cap-drop ALL"],
            ["vhpce-runner", "GCC + Valgrind for arbitrary user code",
             "Read-only, no network, cap-drop ALL, tmpfs /tmp, non-root"],
            ["vhpce-mpi", "OpenMPI + halo exchange kernel",
             "No network (loopback/shm transport), cap-drop ALL"],
            ["vhpce-cuda", "CUDA toolkit + occupancy kernel (nvcc, sm_120/PTX)",
             "Read-only + --gpus all, no network, cap-drop ALL"],
        ],
        col_widths=[1.2*inch, 2.6*inch, 2.4*inch],
    ))
    story.append(sp(4))
    story.append(body(
        "The untrusted code runner (<font face='Courier'>vhpce-runner</font>) applies the "
        "strictest isolation: <font face='Courier'>--network none</font> (no internet), "
        "<font face='Courier'>--cap-drop ALL</font> (no Linux capabilities), "
        "<font face='Courier'>--security-opt no-new-privileges</font>, "
        "<font face='Courier'>--read-only</font> filesystem (except a tmpfs for compilation), "
        "2 GB memory limit, 256 PID limit, and a per-run timeout. Source code is passed via "
        "stdin (never written to the host filesystem). The container runs as a non-root user."
    ))

    story.append(sub("6.3 Execution Flow"))
    story.append(body(
        "A typical measured run proceeds as follows: (1) the web app submits a job to the "
        "gateway; (2) the gateway enqueues it in Redis via Arq; (3) the worker dequeues the "
        "job and spawns the appropriate Docker container; (4) the container runs a thread or "
        "rank sweep (best-of-N timing at each point) and prints results as JSON to stdout; "
        "(5) the worker captures the output, parses it into a ProfileResult, stores it in "
        "Redis, and marks the job done; (6) the web app's next poll retrieves the result and "
        "renders it through the same charts, metrics, and explanations used for model data."
    ))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 7  AI EXPLANATION LAYER
    # ════════════════════════════════════════════════════════════════
    story.append(sec("7. AI-Powered Explanation Layer"))
    story.append(body(
        "VHPCE employs a dual-layer explanation system, summarized as the \"Both\" design: "
        "an always-on deterministic explainer plus an optional live-LLM panel. The two layers "
        "cooperate, with the deterministic layer grounding the LLM to prevent hallucination."
    ))

    story.append(sub("7.1 Deterministic Explainer"))
    story.append(body(
        "The deterministic engine (<font face='Courier'>packages/explain</font>) is a pure "
        "function: <font face='Courier'>explain(result, context) → Explanation[]</font>. "
        "It runs ordered rule checks over the ProfileResult. Each rule has a guard condition "
        "and emits a structured finding when triggered, containing: <b>what</b> (observed "
        "symptom with actual numbers), <b>why</b> (the mechanism, naming the HPC concept), "
        "<b>how</b> (a concrete fix), and <b>expected gain</b> (quantified from the model). "
        "Findings are deterministic, reproducible, and testable. They appear under every "
        "experiment as the default explanation—no API key required."
    ))

    story.append(sub("7.2 LLM Panel"))
    story.append(body(
        "The optional \"Ask the AI\" panel uses the Anthropic Claude SDK (streaming) to "
        "answer open-ended follow-up questions. The key design decision is <b>grounding</b>: "
        "the LLM receives the deterministic findings as authoritative ground truth alongside "
        "the ProfileResult summary and the student's question. The system prompt instructs "
        "the model to explain and extend the deterministic findings, not to invent competing "
        "numbers. This is the primary hallucination control."
    ))
    story.append(body(
        "The system prompt is large and static, making it an ideal candidate for Anthropic's "
        "prompt caching—reducing cost on repeated queries. API keys are provided via a "
        "server-side environment variable for hosted deployments, or per-session in the "
        "browser (kept per-tab, never persisted). Without any key, the panel shows a notice "
        "and the deterministic explanations remain fully active."
    ))

    story.append(sub("7.3 Comparison"))
    story.append(make_table(
        ["", "Deterministic", "LLM Panel"],
        [
            ["Availability", "Always, offline, free", "Requires API key"],
            ["Output", "Structured, exact numbers", "Conversational, handles follow-ups"],
            ["Risk", "None (computed)", "Hallucination (mitigated by grounding)"],
            ["Role", "Default explanation for every experiment",
             "\"Ask the AI\" for deeper or what-if questions"],
        ],
        col_widths=[1.3*inch, 2.4*inch, 2.6*inch],
    ))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 8  DEPLOYMENT MODEL
    # ════════════════════════════════════════════════════════════════
    story.append(sec("8. Deployment Model"))
    story.append(body(
        "VHPCE is designed for progressive deployment across three tiers, each adding "
        "capability without requiring the student to redo previous steps:"
    ))

    story.append(make_table(
        ["Tier", "What Students Get", "Requirements"],
        [
            ["0 — Model",
             "Full UI, every experiment (Model mode), interactive 2D Canvas, offline",
             "Node.js ≥ 20.9 + pnpm. Any OS."],
            ["1 — Measured (CPU)",
             "Real OpenMP/MPI runs on actual cores; Code Playground compiles and executes",
             "+ Docker"],
            ["2 — Measured (GPU)",
             "CUDA experiments (occupancy, coalescing, divergence, atomics) on a real GPU",
             "+ NVIDIA GPU + nvidia-container-toolkit"],
        ],
        col_widths=[1.3*inch, 2.8*inch, 2.2*inch],
    ))
    story.append(sp(6))

    story.append(sub("8.1 Zero-Install Option"))
    story.append(body(
        "The repository includes a devcontainer configuration for GitHub Codespaces. "
        "Students click \"Code → Codespaces → Create codespace\" and Tier 0 is "
        "ready immediately with all dependencies pre-installed. Tier 1 also works inside "
        "the Codespace via Docker-in-Docker."
    ))

    story.append(sub("8.2 Classroom Gateway"))
    story.append(body(
        "For institutional deployments, a single shared gateway gives an entire class Measured "
        "mode and a working Playground without requiring Docker on student machines. The "
        "instructor runs the gateway (Tiers 1/2) on a server and students point their web app "
        "at it via the <font face='Courier'>NEXT_PUBLIC_VHPCE_API</font> environment variable. "
        "The gateway's code runner is sandboxed (no network, capability-dropped, read-only "
        "filesystem, resource limits), but institutions are advised to place it behind "
        "authentication or a campus VPN."
    ))

    story.append(sub("8.3 Continuous Integration"))
    story.append(body(
        "A GitHub Actions workflow runs on every push and pull request: install, typecheck "
        "(TypeScript), lint (ESLint), and production build. This ensures the codebase stays "
        "clean across contributions."
    ))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 9  FUTURE WORK
    # ════════════════════════════════════════════════════════════════
    story.append(sec("9. Future Work"))
    story.append(body(
        "VHPCE has completed Phases 0 through 4 plus the Cloud Phase and engagement layer. "
        "Phase 5 is underway with the domain labs, and several directions remain for future "
        "development:"
    ))

    future = [
        "<b>Additional domain modules.</b> FEM (heat/stress) and CFD (Navier-Stokes "
        "lid-driven cavity) — each as a new tab in the Domain Labs hub, following the "
        "established pattern of tab-based navigation, rAF canvas animation, and "
        "domain-decomposition code snippets.",
        "<b>True hardware PMU counters.</b> WSL2 does not expose the host PMU, so cache-miss "
        "and IPC counters currently come from Valgrind cachegrind (simulated). Deploying on "
        "bare-metal Linux nodes would unlock <font face='Courier'>perf</font>/LIKWID/PAPI "
        "for precise hardware event counting.",
        "<b>Kubernetes autoscaling.</b> The Arq worker currently runs max_jobs=1. Moving "
        "sandbox execution to Kubernetes Jobs with a horizontal pod autoscaler would support "
        "concurrent multi-student workloads.",
        "<b>LMS integration.</b> Connecting the badge/streak system to institutional "
        "Learning Management Systems (Canvas, Moodle) for grade passback and assignment "
        "tracking.",
        "<b>Nsight Compute integration.</b> For GPU experiments, integrating Nsight Compute "
        "kernel-level counters (achieved occupancy, memory throughput, warp stall reasons) "
        "would add hardware-level detail beyond what the CUDA Occupancy API provides.",
    ]
    for f in future:
        story.append(bullet(f))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════
    # 10  CONCLUSION
    # ════════════════════════════════════════════════════════════════
    story.append(sec("10. Conclusion"))
    story.append(body(
        "VHPCE demonstrates that the gap between HPC theory and practice can be effectively "
        "bridged by a platform that prioritizes <b>performance intuition over syntax "
        "memorization</b>. By building on a single data contract—the ProfileResult "
        "seam—the platform achieves a separation of concerns that is both architecturally "
        "clean and pedagogically powerful: students interact with the same charts, metrics, "
        "and explanations regardless of whether the data comes from an instant physics model "
        "or from a real measurement on their own hardware."
    ))
    story.append(body(
        "The predict-before-you-run methodology, the visual immediacy of animated hardware "
        "behavior, and the deterministic diagnostic engine work together to build the kind "
        "of intuition that is difficult to develop from textbooks and difficult to retain from "
        "lectures. The optional LLM layer extends this with conversational depth while "
        "remaining grounded in computed facts."
    ))
    story.append(body(
        "The tiered deployment model—from a zero-install Codespace to a GPU-accelerated "
        "Docker setup—ensures that the platform is accessible to students with varying "
        "hardware and institutional resources. The classroom gateway pattern lets instructors "
        "provide the full Measured experience without requiring Docker on every student machine."
    ))
    story.append(body(
        "With sixteen flagship experiments (all with Model and Measured backends), a "
        "228-entry command reference, six engineering domain labs, a sandboxed code "
        "playground, and a gamification layer, VHPCE provides "
        "a comprehensive environment for teaching parallel computing. The platform is open "
        "source under the GNU AGPL-3.0 license and available at "
        "<font color='#0f7173'>https://github.com/nikosvil/VHPCE</font>."
    ))

    story.append(sp(24))
    story.append(hr())
    story.append(sp(8))
    story.append(Paragraph(
        "VHPCE is licensed under the GNU Affero General Public License v3.0.",
        S["FooterStyle"],
    ))
    story.append(Paragraph(
        "Source code: https://github.com/nikosvil/VHPCE",
        S["FooterStyle"],
    ))

    doc.build(story)
    print(f"Whitepaper written to {OUT}")


if __name__ == "__main__":
    build()
