import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { db, sites } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import fs from "fs-extra";
import path from "path";

// Utility to ensure we don't traverse out of the docRoot
function getSafePath(docRoot: string, requestPath: string): string {
  const safePath = path.normalize(path.join(docRoot, requestPath));
  if (!safePath.startsWith(docRoot)) {
    throw new Error("Path traversal blocked");
  }
  return safePath;
}

export const filesRouter = router({
  list: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), directory: z.string().default("/") }))
    .query(async ({ input }) => {
      const [site] = await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1);
      if (!site) throw new Error("Site not found");

      const targetPath = getSafePath(site.docRoot, input.directory);
      
      if (!await fs.pathExists(targetPath)) {
        throw new Error("Directory does not exist");
      }

      const items = await fs.readdir(targetPath, { withFileTypes: true });
      
      return items.map(item => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        path: path.posix.join(input.directory, item.name),
      })).sort((a, b) => {
        // Sort directories first
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    }),

  readFile: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), filePath: z.string() }))
    .query(async ({ input }) => {
      const [site] = await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1);
      if (!site) throw new Error("Site not found");

      const targetPath = getSafePath(site.docRoot, input.filePath);
      
      if (!await fs.pathExists(targetPath)) {
        throw new Error("File does not exist");
      }

      const stat = await fs.stat(targetPath);
      if (stat.size > 5 * 1024 * 1024) { // 5MB limit for inline viewing
        throw new Error("File too large to view in editor (max 5MB).");
      }

      const content = await fs.readFile(targetPath, "utf-8");
      return content;
    }),

  writeFile: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), filePath: z.string(), content: z.string() }))
    .mutation(async ({ input }) => {
      const [site] = await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1);
      if (!site) throw new Error("Site not found");

      const targetPath = getSafePath(site.docRoot, input.filePath);
      
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, input.content);
      
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ siteId: z.string().uuid(), targetPath: z.string() }))
    .mutation(async ({ input }) => {
      const [site] = await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1);
      if (!site) throw new Error("Site not found");

      const absPath = getSafePath(site.docRoot, input.targetPath);
      
      // Prevent deleting the root document root itself
      if (absPath === site.docRoot || absPath === site.docRoot + "/") {
        throw new Error("Cannot delete document root");
      }

      await fs.remove(absPath);
      
      return { success: true };
    }),
});
