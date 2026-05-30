/**
 * Hashline 工具 API 路由
 * 
 * 提供 hashline-read 和 hashline-edit 工具的 HTTP 接口
 */

import { NextResponse } from "next/server";
import {
  HashlineToolManager,
  executeHashlineRead,
  executeHashlineEdit,
} from "@/lib/hashline-tool";

// POST /api/hashline/read - 读取文件并返回带哈希头的内容
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action: "read" | "edit";
      path?: string;
      input?: string;
      cwd?: string;
    };

    const cwd = body.cwd || process.cwd();

    if (body.action === "read") {
      if (!body.path) {
        return NextResponse.json(
          { error: "path is required for read action" },
          { status: 400 }
        );
      }

      const result = await executeHashlineRead({ path: body.path }, cwd);
      return NextResponse.json({ success: true, data: result });
    }

    if (body.action === "edit") {
      if (!body.input) {
        return NextResponse.json(
          { error: "input is required for edit action" },
          { status: 400 }
        );
      }

      const result = await executeHashlineEdit({ input: body.input }, cwd);
      return NextResponse.json({ success: true, data: result });
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'read' or 'edit'" },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
