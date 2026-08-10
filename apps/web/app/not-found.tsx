import React from "react";
import Image from "next/image";
import Link from "next/link";
import DashboardPageLayout from "@/components/dashboard/layout";
import CuteRobotIcon from "@/components/icons/cute-robot";

export default function NotFound() {
  return (
    <DashboardPageLayout
      header={{
        title: "Not found",
        icon: CuteRobotIcon,
      }}
    >
      <div className="flex flex-col items-center justify-center gap-10 flex-1">
        <picture className="w-1/4 aspect-square grayscale opacity-50">
          <Image
            src="/assets/bot_greenprint.gif"
            alt="Security Status"
            width={1000}
            height={1000}
            quality={90}
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="size-full object-contain"
          />
        </picture>

        {/* A 404 with no way out is a dead end; give both destinations. */}
        <div className="flex flex-col items-center justify-center gap-4">
          <h1 className="text-xl font-bold uppercase text-muted-foreground">
            Not found, yet
          </h1>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              Trading terminal
            </Link>
            <Link
              href="/mev"
              className="rounded-md border border-success/40 bg-success/5 px-3 py-1.5 text-xs uppercase tracking-wider text-success transition-colors hover:bg-success/10"
            >
              MEV Shield
            </Link>
          </div>
        </div>
      </div>
    </DashboardPageLayout>
  );
}
