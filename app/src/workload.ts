// Fixed workloads so every request does exactly the same amount of work.
// Tune CPU_ITEMS once on your instance so /cpu takes roughly 10-30 ms.

export const CPU_ITEMS = Number(process.env.CPU_ITEMS ?? 5000);
export const IO_DELAY_MS = Number(process.env.IO_DELAY_MS ?? 20);

export function cpuWork(): { items: number; checksum: number } {
  const rows = [];
  for (let i = 0; i < CPU_ITEMS; i++) {
    rows.push({
      id: i,
      name: `user-${(i * 2654435761) % 100000}`,
      score: Math.sin(i) * 1000,
      tags: ['a', 'b', 'c'].map((t) => t + (i % 7)),
    });
  }
  rows.sort((a, b) => a.score - b.score);
  const copy = JSON.parse(JSON.stringify(rows)) as typeof rows;
  let checksum = 0;
  for (const r of copy) checksum = (checksum + r.name.length * r.id) % 1_000_000_007;
  return { items: copy.length, checksum };
}

export function ioWork(): Promise<void> {
  // Simulates waiting on a database/network call without adding a real DB.
  return new Promise((resolve) => setTimeout(resolve, IO_DELAY_MS));
}
