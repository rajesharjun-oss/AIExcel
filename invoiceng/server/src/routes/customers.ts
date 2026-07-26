import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { customers } from "../db/schema.js";
import { normalizeNgPhone } from "../domain/phone.js";

const CustomerBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(20).optional(),
  email: z.string().trim().email().max(254).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const IdParamSchema = z.object({ id: z.string().uuid() });

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  const { db, now } = app.deps;

  app.post("/", async (req, reply) => {
    const user = req.currentUser!;
    const body = CustomerBodySchema.parse(req.body);
    const phone = body.phone !== undefined ? normalizeNgPhone(body.phone) : null;
    const id = randomUUID();
    db.insert(customers)
      .values({
        id,
        businessId: user.businessId,
        name: body.name,
        phone,
        email: body.email ?? null,
        notes: body.notes ?? null,
        createdAt: now(),
      })
      .run();
    return reply.code(201).send({ id, name: body.name, phone, email: body.email ?? null });
  });

  app.get("/", async (req) => {
    const user = req.currentUser!;
    const q = ListQuerySchema.parse(req.query);
    const rows = db
      .select()
      .from(customers)
      .where(eq(customers.businessId, user.businessId))
      .orderBy(desc(customers.createdAt))
      .limit(q.limit)
      .offset(q.offset)
      .all();
    return { customers: rows, limit: q.limit, offset: q.offset };
  });

  app.get("/:id", async (req, reply) => {
    const user = req.currentUser!;
    const { id } = IdParamSchema.parse(req.params);
    const row = db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.businessId, user.businessId)))
      .get();
    if (!row) return reply.code(404).send({ error: "not found" });
    return row;
  });

  app.patch("/:id", async (req, reply) => {
    const user = req.currentUser!;
    const { id } = IdParamSchema.parse(req.params);
    const body = CustomerBodySchema.partial().parse(req.body);
    const phone = body.phone !== undefined ? normalizeNgPhone(body.phone) : undefined;
    const updates: Partial<typeof customers.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (phone !== undefined) updates.phone = phone;
    if (body.email !== undefined) updates.email = body.email;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (Object.keys(updates).length === 0) return reply.code(400).send({ error: "nothing to update" });
    const res = db
      .update(customers)
      .set(updates)
      .where(and(eq(customers.id, id), eq(customers.businessId, user.businessId)))
      .run();
    if (res.changes === 0) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
