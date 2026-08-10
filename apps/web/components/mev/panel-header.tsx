"use client";

import type { ReactNode } from "react";
import { CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Bullet } from "@/components/ui/bullet";
import { cn } from "@/lib/core";

/**
 * A panel header: coloured accent, uppercase mono title, optional right slot.
 * Every panel uses it so the page reads as one instrument rather than a stack
 * of unrelated cards.
 */
export function PanelHeader({
  title,
  bullet = "default",
  icon,
  action,
  className,
}: {
  title: ReactNode;
  bullet?: "default" | "success" | "warning" | "destructive";
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <CardHeader className={cn("items-center", className)}>
      <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Bullet variant={bullet} />
        {icon}
        {title}
      </CardTitle>
      {action ? <CardAction className="self-center">{action}</CardAction> : null}
    </CardHeader>
  );
}
