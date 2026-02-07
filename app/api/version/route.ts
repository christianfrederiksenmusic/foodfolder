import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.GIT_COMMIT_SHA ||
    "unknown";

  return NextResponse.json({ sha });
}
