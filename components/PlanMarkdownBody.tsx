"use client";

import { MarkdownBody } from "./MarkdownBody";

interface PlanMarkdownBodyProps {
  children: string;
  className?: string;
}

export function PlanMarkdownBody({ children, className }: PlanMarkdownBodyProps) {
  return <MarkdownBody className={className}>{children}</MarkdownBody>;
}
