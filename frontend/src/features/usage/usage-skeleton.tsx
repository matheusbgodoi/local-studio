import { AppPage, Card, PageContainer } from "@/ui";

const pulse = "animate-pulse rounded bg-(--ui-surface-2)";

export function UsageSkeleton() {
  return (
    <AppPage>
      <PageContainer width="sm" className="pt-5 sm:pt-7">
        <div className="flex items-center justify-between">
          <div className={`${pulse} h-9 w-40 rounded-full`} />
          <div className={`${pulse} h-7 w-7 rounded-full`} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <div className={`${pulse} h-7 w-56 rounded-full`} />
          <div className="grow" />
          <div className={`${pulse} h-7 w-64 rounded-full`} />
          <div className={`${pulse} h-7 w-28 rounded-full`} />
        </div>
        <div className={`${pulse} mt-4 h-3 w-full max-w-[40rem]`} />
        <div className="flex flex-col items-center pt-12">
          <div className={`${pulse} h-3 w-32`} />
          <div className={`${pulse} mt-4 h-14 w-64`} />
          <div className={`${pulse} mt-4 h-3 w-80`} />
        </div>
        <Card padding="sm" className="mx-auto mt-8 max-w-[55rem]">
          <div className="grid grid-cols-3 gap-8 px-5 py-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <div className={`${pulse} h-2.5 w-14`} />
                <div className={`${pulse} h-4 w-16`} />
              </div>
            ))}
          </div>
        </Card>
        <div className="mx-auto mt-5 grid max-w-[55rem] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className={`${pulse} h-40 w-full opacity-70`} />
          ))}
        </div>
        <div className="mx-auto mt-6 max-w-[55rem]">
          <div className={`${pulse} mb-3 h-3 w-36`} />
          <div className={`${pulse} h-28 w-full opacity-70`} />
        </div>
      </PageContainer>
    </AppPage>
  );
}
