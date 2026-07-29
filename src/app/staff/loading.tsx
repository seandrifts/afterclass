import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 py-5">
      <Skeleton className="h-12 w-full" />
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <Skeleton className="mt-5 h-40 w-full" />
    </main>
  );
}
