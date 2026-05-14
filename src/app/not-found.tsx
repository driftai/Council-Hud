import Link from "next/link";

export const metadata = {
  title: "Council HUD | Off-grid",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center">
      <h1 className="font-mono text-4xl font-bold uppercase tracking-widest text-destructive">
        Signal_Lost
      </h1>
      <p className="max-w-md font-mono text-sm text-muted-foreground">
        That coordinate isn&apos;t part of the Council grid. Return to base.
      </p>
      <Link
        href="/"
        className="rounded border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs uppercase text-primary hover:bg-primary/20"
      >
        Return to HUD
      </Link>
    </main>
  );
}
