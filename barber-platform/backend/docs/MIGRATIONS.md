# Prisma Migrations – How to Add or Update

This guide explains how to add and apply migrations correctly in the barber platform.

---

## Prerequisites

- `DATABASE_URL` and **`DIRECT_URL`** in `.env` when using Supabase **pooler** for `DATABASE_URL`: set `DIRECT_URL` to the **Direct connection** string from the dashboard (`db.*.supabase.co:5432`). Prisma runs migrations against `directUrl`, not the pooler (avoids P1002 advisory lock timeouts).
- Database accessible (local or remote)
- Stop the backend server before running migrations (avoids EPERM/lock issues on Windows)

---

## Workflow: Adding a New Migration

### 1. Edit the schema

Edit `prisma/schema.prisma` – add models, fields, indexes, relations, etc.

```prisma
model NewThing {
  id         String   @id @default(uuid())
  businessId String
  name       String
  createdAt  DateTime @default(now())

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@index([businessId])
  @@map("new_things")
}
```

### 2. Create and apply the migration

```bash
cd barber-platform/backend
npx prisma migrate dev --name add_new_thing
```

- `--name` is a short, descriptive name (e.g. `add_customer_visits`, `add_automation_rules`)
- Prisma will:
  - Create a new folder under `prisma/migrations/`
  - Generate SQL from schema changes
  - Apply the migration to your database
  - Run `prisma generate` to update the Prisma Client

### 3. Commit the migration

```bash
git add prisma/migrations/
git add prisma/schema.prisma
git commit -m "Add new_thing table migration"
```

---

## Workflow: Updating an Existing Migration (Before It’s Applied)

If the migration has **not** been applied in production yet:

1. Delete the migration folder: `prisma/migrations/YYYYMMDDHHMMSS_migration_name/`
2. Edit `schema.prisma` with the desired changes
3. Run `npx prisma migrate dev --name migration_name` again

---

## Workflow: Changing Schema After Migration Was Applied

If the migration **has** been applied (locally or in production):

1. Edit `schema.prisma` with the new changes
2. Create a **new** migration:

   ```bash
   npx prisma migrate dev --name describe_your_change
   ```

3. Do **not** edit or delete existing migration files that have already been applied.

---

## Commands Reference

| Command | When to use |
|--------|-------------|
| `npx prisma migrate dev` | Development – create and apply migrations |
| `npx prisma migrate dev --name my_change` | Same, with explicit migration name |
| `npx prisma migrate deploy` | Production – apply pending migrations only |
| `npx prisma migrate status` | Check migration status |
| `npx prisma generate` | Regenerate Prisma Client (after schema changes) |
| `npx prisma db push` | Prototype only – sync schema without migrations (no history) |

---

## Production Deployment

Use `migrate deploy` in production. It only applies pending migrations and does not create new ones:

```bash
npx prisma migrate deploy
```

Or via npm script:

```bash
npm run prisma:migrate:prod
```

---

## Common Issues

### EPERM / “Access denied” on Windows

- Stop the NestJS backend (`npm run start:dev`)
- Close Prisma Studio if open
- Run `npx prisma generate` or `npx prisma migrate dev` again

### “Migration failed to apply cleanly”

- Check `prisma/migrations/` for conflicting or broken SQL
- If the migration is new and not in production, delete it and recreate with `migrate dev`

### Schema and database out of sync

```bash
npx prisma migrate status
```

- If there are pending migrations: run `npx prisma migrate deploy` (prod) or `npx prisma migrate dev` (dev)
- If the schema was changed outside migrations: create a new migration to align schema and DB

### Need to reset the database (dev only)

```bash
npx prisma migrate reset
```

This drops the database, reapplies all migrations, and runs the seed script. **Never use in production.**

---

## Best Practices

1. **One logical change per migration** – easier to review and roll back
2. **Descriptive names** – e.g. `add_customer_visits`, `add_index_on_email`
3. **Commit migrations with schema** – keep `prisma/migrations/` and `schema.prisma` in version control
4. **Review generated SQL** – check `migration.sql` before applying
5. **Test locally first** – run `migrate dev` and verify before deploying
