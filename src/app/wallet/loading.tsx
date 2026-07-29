import { Card, Screen, Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <Screen>
      <div className="mb-5 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-32" />
        </div>
        <Skeleton className="h-9 w-16" />
      </div>

      <Card className="text-center">
        {/* 骨架的形狀要對應真實內容，不然載完會跳版 */}
        <Skeleton className="mx-auto h-14 w-40" />
        <Skeleton className="mx-auto mt-3 h-6 w-48" />
        <Skeleton className="mx-auto mt-6 size-60 rounded-2xl" />
        <Skeleton className="mx-auto mt-3 h-6 w-36" />
      </Card>

      <Skeleton className="mt-4 h-20 w-full" />
    </Screen>
  );
}
