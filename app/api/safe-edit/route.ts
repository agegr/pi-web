/**
 * 安全编辑 API 路由
 * 
 * 提供安全的文件编辑功能，防止自修改导致崩溃
 */

import { NextResponse } from "next/server";
import {
  safeEdit,
  safeBatchEdit,
  checkEditSafety,
  listBackups,
  cleanupBackups,
} from "@/lib/safe-edit-guard";

// POST /api/safe-edit - 安全编辑文件
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action: "edit" | "batch-edit" | "check" | "list-backups" | "cleanup";
      filePath?: string;
      newContent?: string;
      edits?: Array<{ filePath: string; newContent: string }>;
      options?: {
        autoBackup?: boolean;
        runTypeCheck?: boolean;
        runLint?: boolean;
        autoRestore?: boolean;
      };
      keepCount?: number;
    };

    const { action, options } = body;

    switch (action) {
      case "edit": {
        if (!body.filePath || !body.newContent) {
          return NextResponse.json(
            { error: "filePath and newContent are required" },
            { status: 400 }
          );
        }

        const result = await safeEdit(body.filePath, body.newContent, options);
        return NextResponse.json({ success: true, data: result });
      }

      case "batch-edit": {
        if (!body.edits || body.edits.length === 0) {
          return NextResponse.json(
            { error: "edits array is required" },
            { status: 400 }
          );
        }

        const results = await safeBatchEdit(body.edits, options);
        return NextResponse.json({ success: true, data: results });
      }

      case "check": {
        if (!body.filePath || !body.newContent) {
          return NextResponse.json(
            { error: "filePath and newContent are required" },
            { status: 400 }
          );
        }

        const result = await checkEditSafety(body.filePath, body.newContent);
        return NextResponse.json({ success: true, data: result });
      }

      case "list-backups": {
        const backups = await listBackups();
        return NextResponse.json({ success: true, data: backups });
      }

      case "cleanup": {
        const deletedCount = await cleanupBackups(body.keepCount);
        return NextResponse.json({
          success: true,
          data: { deletedCount },
        });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
