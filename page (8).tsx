import Link from "next/link";
import { BarrelGlyph } from "@/components/BarrelGlyph";

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-black">
      <Header />
      <Hero />
      <Problem />
      <Solution />
      <HowItWorks />
      <WhoItsFor />
      <WhyAquaMessenger />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 bg-white flex items-center justify-between px-6 py-4 border-b border-rule">
      <div>
        <div className="font-display uppercase tracking-[0.03em] text-lg text-navy leading-none">
          Aqua Messenger
        </div>
        <div className="text-[0.6875rem] uppercase tracking-[0.14em] text-grey">
          A Hydrant Alert System
        </div>
      </div>
      <Link
        href="/console"
        className="font-display uppercase tracking-[0.03em] text-sm border border-navy text-navy px-4 py-2 hover:bg-navy hover:text-white"
      >
        Open Console
      </Link>
    </header>
  );
}

/** Section rule + figure number, the plan-sheet device used throughout. */
function FigureHead({ fig, title }: { fig: string; title: string }) {
  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <span className="text-[0.6875rem] uppercase tracking-[0.14em] text-grey whitespace-nowrap">
          {fig}
        </span>
        <span className="h-px bg-rule flex-1" />
      </div>
      <h2 className="font-display uppercase tracking-[0.03em] text-3xl sm:text-4xl md:text-5xl text-navy leading-none mb-8">
        {title}
      </h2>
    </>
  );
}

function Hero() {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-20 pb-24">
      <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-grey mb-6">
        Hydrant Monitoring · Retrofit Sensor
      </p>
      <div className="flex flex-col md:flex-row gap-12 md:gap-16 items-start">
        <div className="flex-1">
          <h1 className="font-display uppercase tracking-[0.03em] text-4xl sm:text-5xl md:text-6xl text-navy leading-[0.95] mb-8">
            Know the moment a hydrant fails, before the street does.
          </h1>
          <p className="text-[1.0625rem] leading-relaxed max-w-xl mb-10">
            Aqua Messenger is a small computer that fits inside a fire hydrant and watches for
            leaks, tampering, and movement, and remotely alerts the fire department the moment
            something&rsquo;s wrong.
          </p>
          <Link
            href="/console"
            className="inline-block font-display uppercase tracking-[0.03em] bg-navy text-white px-6 py-3"
          >
            View Operations Console
          </Link>
        </div>

        {/* Placeholder for the device CAD render. Swap the contents of this
            frame for the real export — the caption stays. */}
        <figure className="w-full md:w-[38%] shrink-0">
          <div className="bg-mist border border-rule h-[340px] md:h-auto md:aspect-4/5 flex items-center justify-center gap-5">
            <BarrelGlyph wet={false} size={140} />
            <BarrelGlyph wet size={140} />
          </div>
          <figcaption className="text-[0.6875rem] uppercase tracking-[0.14em] text-grey mt-3">
            Aqua Messenger device CAD render
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="border-t border-rule">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <FigureHead fig="Fig. 01 — The Problem" title="Hydrants fail quietly." />
        <div className="flex flex-col md:flex-row gap-12">
          <div className="flex-1 flex flex-col gap-5 text-[1.0625rem] leading-relaxed max-w-2xl">
            <p>
              The streets are flooded. It&rsquo;s a hot summer day in New York City, and a kid is
              trying to cool off by illegally opening a fire hydrant. While this scene is familiar
              and iconic to New Yorkers, it has major consequences for our communities.
            </p>
            <p>
              When a fire hydrant is uncapped illegally,{" "}
              <strong className="font-semibold">1,000 gallons of water are lost per minute</strong>.
              Picture a standard household bathtub. Now imagine filling it to the absolute brim,
              dumping it into the street every 10 seconds, and repeating that for hours on end.
              That&rsquo;s how much water is wasted by a single open fire hydrant.
            </p>
            <p>
              Each year, more than 1,000 hydrants have to be replaced in New York City alone. Aqua
              Messenger plans on assisting local New York City agencies in that process of repair.
            </p>
          </div>
          <div className="md:w-[30%] shrink-0 flex flex-col gap-6">
            <Stat figure="1,000" unit="gallons per minute" note="lost from one open hydrant" />
            <Stat figure="1,000+" unit="hydrants" note="replaced in NYC each year" />
            <Stat figure="109,725" unit="hydrants" note="in the NYC DEP register today" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ figure, unit, note }: { figure: string; unit: string; note: string }) {
  return (
    <div className="border-l-[3px] border-navy pl-4">
      <div className="font-data text-[2.5rem] leading-none text-navy">{figure}</div>
      <div className="text-[0.75rem] uppercase tracking-[0.06em] font-semibold text-grey mt-1">
        {unit}
      </div>
      <div className="text-[0.8125rem] text-black/70 mt-1">{note}</div>
    </div>
  );
}

function Solution() {
  const steps = [
    "A small sensor computer is inserted directly into the hydrant.",
    "It detects leaks, illegal usage, and movement in real time.",
    "It immediately alerts the fire department when something's wrong.",
  ];
  return (
    <section className="border-t border-rule bg-mist">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <FigureHead fig="Fig. 02 — The Solution" title="A small computer, built for a big pipe." />
        <ol className="grid sm:grid-cols-3 gap-px bg-rule border border-rule">
          {steps.map((body, i) => (
            <li key={i} className="bg-white p-6 flex flex-col gap-3">
              <span className="font-data text-[1.75rem] leading-none text-navy">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="text-[0.9375rem] leading-relaxed">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "Sensors detect issues",
      body: "The sensor inside the hydrant picks up on leaks, tampering, or movement.",
    },
    {
      title: "Alerts reach departments",
      body: "The system sends an alert straight to the relevant department.",
    },
    {
      title: "The app tracks it",
      body: "An app maps hydrant locations and logs potential risks over time.",
    },
  ];
  return (
    <section className="border-t border-rule">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <FigureHead fig="Fig. 03 — How It Works" title="Three steps, start to finish." />
        <ol className="flex flex-col">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="flex flex-col sm:flex-row gap-4 sm:gap-8 py-6 border-t border-rule first:border-t-0"
            >
              <span className="font-data text-[1.75rem] leading-none text-grey sm:w-16 shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-display uppercase tracking-[0.03em] text-xl text-navy mb-2">
                  {s.title}
                </h3>
                <p className="text-[0.9375rem] leading-relaxed max-w-xl">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function WhoItsFor() {
  const readers = [
    {
      title: "FDNY",
      body: "Aqua Messenger provides reassurance that hydrants are working and reduces the workload of checking them manually.",
    },
    {
      title: "Municipal Water Department",
      body: "Catching leaks and illegal use early means water pressure remains steady across the system.",
    },
  ];
  return (
    <section className="border-t border-rule bg-mist">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <FigureHead fig="Fig. 04 — Who It's For" title="Built for the teams who answer the call." />
        <div className="grid sm:grid-cols-2 gap-px bg-rule border border-rule">
          {readers.map((r) => (
            <div key={r.title} className="bg-white p-8">
              <h3 className="font-display uppercase tracking-[0.03em] text-2xl text-navy mb-3">
                {r.title}
              </h3>
              <p className="text-[0.9375rem] leading-relaxed">{r.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyAquaMessenger() {
  const today = [
    "The current system relies on residents to notice a problem and report it.",
    "Other monitoring systems aren't designed to detect tampering.",
  ];
  const ours = [
    "Leaks, illegal use, and movement are detected automatically, from inside the hydrant.",
    "Departments are alerted immediately — no phone call needed.",
  ];
  return (
    <section className="border-t border-rule">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <FigureHead
          fig="Fig. 05 — Why Aqua Messenger"
          title="Built to catch what today's systems miss."
        />
        <p className="text-[1.0625rem] leading-relaxed max-w-2xl mb-10">
          Most hydrant monitoring today isn&rsquo;t monitoring at all — it&rsquo;s waiting.
        </p>
        <div className="grid sm:grid-cols-2 gap-8">
          <Column label="Today" items={today} />
          <Column label="Aqua Messenger" items={ours} emphasis />
        </div>
      </div>
    </section>
  );
}

function Column({
  label,
  items,
  emphasis = false,
}: {
  label: string;
  items: string[];
  emphasis?: boolean;
}) {
  return (
    <div>
      <div
        className={`font-display uppercase tracking-[0.03em] text-sm px-3 py-2 mb-4 ${
          emphasis ? "bg-navy text-white" : "bg-mist text-grey"
        }`}
      >
        {label}
      </div>
      <ul className="flex flex-col gap-4">
        {items.map((t) => (
          <li
            key={t}
            className={`text-[0.9375rem] leading-relaxed pl-4 ${
              emphasis ? "border-l-[3px] border-navy" : "border-l border-rule"
            }`}
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-rule bg-navy text-white">
      <div className="max-w-6xl mx-auto px-6 py-20 flex flex-col items-start gap-8">
        <h2 className="font-display uppercase tracking-[0.03em] text-4xl sm:text-5xl leading-none">
          Thank You
        </h2>
        <div className="flex flex-col sm:flex-row sm:items-end gap-8 sm:gap-16">
          <div>
            <div className="text-[0.6875rem] uppercase tracking-[0.14em] text-white/60 mb-1">
              Unit price
            </div>
            <div className="font-data text-[2.5rem] leading-none">$130</div>
          </div>
          <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-white/60 max-w-sm">
            Aqua Messenger — A Hydrant Alert System
          </p>
        </div>
        <Link
          href="/console"
          className="font-display uppercase tracking-[0.03em] border border-white px-6 py-3 hover:bg-white hover:text-navy"
        >
          Open Operations Console
        </Link>
      </div>
    </footer>
  );
}
