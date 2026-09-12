"use client";

import { useEffect, useState, type ReactNode, type MouseEvent } from "react";
import { shouldOpenLocalFileInApp } from "@/lib/file-links";
import { validateFileLink } from "@/lib/file-link-validation";

interface Props {
  filePath: string;
  href?: string;
  title?: string;
  target?: string;
  children: ReactNode;
  fullPathLabel?: string;
  onOpenFile: (path: string) => void;
}

export function LocalFileLink({ filePath, href, target, children, fullPathLabel, onOpenFile }: Props) {
  const [verifiedPath, setVerifiedPath] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const check = () => {
      void validateFileLink(filePath).then((exists) => {
        if (active) setVerifiedPath(exists ? filePath : null);
      });
    };
    check();
    // Recheck files created/deleted by the agent, including previously missing paths.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [filePath]);

  if (verifiedPath !== filePath) return <>{children}</>;

  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!shouldOpenLocalFileInApp(event)) return;
    if (target && target !== "_self") return;
    event.preventDefault();
    // A file may have disappeared since the initial check.
    if (await validateFileLink(filePath)) onOpenFile(filePath);
    else setVerifiedPath(null);
  };

  return (
    <a className="markdown-local-file-link" href={href} title={fullPathLabel ?? filePath} target={target} onClick={handleClick}>
      {children}
    </a>
  );
}
