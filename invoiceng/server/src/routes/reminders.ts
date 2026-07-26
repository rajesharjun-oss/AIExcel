import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { reminderSettings, reminders, invoices, customers } from "../db/schema.js";
import { markWaReminderSent } from "../services/reminders.js";

const SettingsSchema = z.object({
  enabled: z.boolean(),
  daysBeforeDue: z.number().int().min(0).max(30),
  everyNDaysAfterDue: z.number().int().min(1).max(30),
  maxAfterDueCount: z.number().int().min(0).max(20),
});

const IdParamSchema = z.object({ id: z.string().uuid() });

export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  const { db, now } = app.deps;

  app.get("/settings", async (req) => {
    const user = req.currentUser!;
    const row = db
      .select()
      .from(reminderSettings)
      .where(eq(reminderSettings.businessId, user.businessId))
      .get();
    return row ?? { businessId: user.businessId, enabled: true, daysBeforeDue: 2, everyNDaysAfterDue: 3, maxAfterDueCount: 4 };
  });

  app.patch("/settings", async (req) => {
    const user = req.currentUser!;
    const body = SettingsSchema.parse(req.body);
    db.insert(reminderSettings)
      .values({ businessId: user.businessId, ...body })
      .onConflictDoUpdate({ target: reminderSettings.businessId, set: body })
      .run();
    return { ok: true };
  });

  /** The owner's WhatsApp outbox: reminders waiting for a tap-to-send. */
  app.get("/outbox", async (req) => {
    const user = req.currentUser!;
    const rows = db
      .select({
        id: reminders.id,
        invoiceId: reminders.invoiceId,
        invoiceNumber: invoices.number,
        customerName: customers.name,
        seq: reminders.seq,
        channel: reminders.channel,
        status: reminders.status,
        scheduledFor: reminders.scheduledFor,
        waLink: reminders.waLink,
        message: reminders.message,
      })
      .from(reminders)
      .innerJoin(invoices, eq(reminders.invoiceId, invoices.id))
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(
        and(
          eq(reminders.businessId, user.businessId),
          eq(reminders.channel, "wa_link"),
          eq(reminders.status, "ready"),
        ),
      )
      .orderBy(desc(reminders.scheduledFor))
      .limit(100)
      .all();
    return { outbox: rows };
  });

  /** Recent reminder history (all channels). */
  app.get("/history", async (req) => {
    const user = req.currentUser!;
    const rows = db
      .select({
        id: reminders.id,
        invoiceNumber: invoices.number,
        customerName: customers.name,
        seq: reminders.seq,
        channel: reminders.channel,
        status: reminders.status,
        scheduledFor: reminders.scheduledFor,
        sentAt: reminders.sentAt,
      })
      .from(reminders)
      .innerJoin(invoices, eq(reminders.invoiceId, invoices.id))
      .innerJoin(customers, eq(invoices.customerId, customers.id))
      .where(eq(reminders.businessId, user.businessId))
      .orderBy(desc(reminders.scheduledFor))
      .limit(100)
      .all();
    return { reminders: rows };
  });

  app.post("/:id/mark-sent", async (req, reply) => {
    const user = req.currentUser!;
    const { id } = IdParamSchema.parse(req.params);
    const ok = markWaReminderSent(db, user.businessId, id, now());
    if (!ok) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
