# Railway Deployment Guide — Online Tutoring Platform

**Author:** Manus AI  
**Scope:** Express, Socket.io, Prisma/PostgreSQL, JWT authentication, Multer uploads, and static frontend deployment.

## 1. Pre-deployment checklist

Confirm that the repository root contains the supplied `server.js`, `package.json`, `prisma/schema.prisma`, `public/`, `routes/`, `controllers/`, and `middleware/` directories. Install and commit the lockfile locally before connecting Railway so the hosted build resolves the exact tested dependency versions.

| Requirement | Production value | Reason |
|---|---|---|
| Node runtime | `>=20.18.0` | Matches the package manifest engine requirement. |
| Start command | `npm start` | Runs `node server.js`, which listens on Railway’s assigned `PORT`. |
| Build hook | `postinstall: prisma generate` | Generates the Prisma Client after dependency installation. |
| Database | Railway PostgreSQL | Prisma reads only `DATABASE_URL`. |
| Upload persistence | Volume mounted at `/data/uploads` and `UPLOAD_DIR=/data/uploads` | Preserves Multer files beyond a container replacement or redeployment. |

> **Do not commit `.env`, generated uploads, or any token.** Commit only `.env.example` and `package-lock.json`.

## 2. Push the completed codebase to GitHub

Create a new empty GitHub repository, then run the following commands from the project root. Replace the placeholder URL with the repository’s HTTPS or SSH URL.

```bash
git init
git add .
git commit -m "Production-ready online tutoring platform"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/online-tutoring-platform.git
git push -u origin main
```

Before the first push, ensure `.gitignore` contains at least the following entries:

```gitignore
node_modules/
.env
.env.*
!.env.example
public/uploads/
coverage/
.DS_Store
```

## 3. Create the Railway project and application service

Open the [Railway dashboard](https://railway.com/dashboard), choose **Create a New Project**, select **GitHub Repo**, authorize the Railway GitHub integration if prompted, and select the repository. Railway deploys the connected branch and redeploys on later pushes to that branch. This is Railway’s documented GitHub-repository workflow.[1]

Open the new application service and confirm the deployment command is the package default: `npm start`. The supplied `package.json` makes this explicit, so no custom start command is necessary.

## 4. Add Railway PostgreSQL and connect it privately

On the Railway project canvas, choose **+ New** and add a **PostgreSQL** database service. Railway exposes `DATABASE_URL` and individual `PG*` variables to services in the project; its database is private by default, which is the preferred setup for this application.[2]

Return to the application service’s **Variables** tab. Add `DATABASE_URL` by using the variable-reference picker and selecting the PostgreSQL service’s `DATABASE_URL`. Do **not** copy database credentials into Git, the source code, or a browser client.

## 5. Configure application environment variables

Add the following variables to the **application service**, not to the PostgreSQL service. Generate a new JWT secret locally; never reuse the example value.

```bash
openssl rand -base64 48
```

| Variable | Required production value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Reference to the Railway PostgreSQL service’s `DATABASE_URL` variable. |
| `JWT_SECRET` | Output of a cryptographically random command such as `openssl rand -base64 48`. |
| `JWT_EXPIRES_IN` | `8h` or another intentional short lifetime. |
| `TEACHER_PASSCODE` | A long private administrator credential; never use the development default. |
| `CLIENT_ORIGIN` | The exact Railway public URL, for example `https://your-service.up.railway.app`. Add a comma-separated custom domain as well when applicable. |
| `ENABLE_OPEN_CORS` | `false` or absent. |
| `UPLOAD_DIR` | `/data/uploads`, matching the Railway Volume mount path. |

Do **not** set `PORT` manually. Railway provides it at runtime and the server uses `process.env.PORT || 3000`.

> **CORS trade-off:** The server rejects browser origins that are not listed in `CLIENT_ORIGIN`. This is appropriate for authenticated dashboards and live rooms. Setting `ENABLE_OPEN_CORS=true` allows any origin to make browser requests and is acceptable only for a deliberately flexible prototype—not for production.

## 6. Apply the Prisma schema safely

The `postinstall` script generates Prisma Client during every Railway build; it intentionally does **not** mutate the production database. After `DATABASE_URL` is set, deploy the service once, then apply the schema in a controlled maintenance window.

Install and authenticate the Railway CLI, link the local folder to the correct Railway project/service, and open a shell inside the deployed application service:

```bash
npm i -g @railway/cli
railway login
railway link
railway ssh
```

Inside the Railway shell, run:

```bash
npm run db:push
exit
```

The Railway CLI documentation includes `railway login`, `railway link`, and `railway ssh` for this workflow.[3] Take a database backup before applying a schema change to a non-empty production database. `prisma db push` is suitable for this requested schema-sync workflow; when the team adopts committed SQL migrations, replace this operational step with `prisma migrate deploy`.

## 7. Persist uploaded study materials

The application stores Multer files under `UPLOAD_DIR` when set (and falls back to `public/uploads` locally). Add a Railway Volume to the **application service**, mount it at the following path, and set the service variable `UPLOAD_DIR` to the same value:

```text
/data/uploads
```

Without this volume, uploaded PDFs and images can disappear when Railway replaces or redeploys the service container. Railway’s CLI and platform support service volumes, while a future scaling iteration can move this feature to object storage.[3]

## 8. Generate the public domain and finalize CORS

After the application deploys successfully, open the service **Settings**, use **Networking → Generate Domain**, then copy the HTTPS URL into `CLIENT_ORIGIN` and redeploy. Railway documents domain generation from the service’s Networking settings.[1]

Visit the following health check after deployment:

```text
https://YOUR_RAILWAY_DOMAIN/api/health
```

A successful result is JSON with `status: "ok"`. Then perform a full smoke test: register or load a student, authenticate as a parent and teacher, load a teacher roster, upload a permitted test PDF, open the parent dashboard, and test a short live session with a second browser profile.

## 9. Operational checks after launch

Use Railway logs to inspect startup, Prisma, and Socket.io errors. Confirm that `DATABASE_URL` is resolved, uploaded files survive a redeploy, and the live domain appears in `CLIENT_ORIGIN`. Monitor the PostgreSQL service and enable regular backups; Railway specifically recommends backups and observability for production databases.[2]

The present Socket.io room state is intentionally process-local. Keep the service at one application replica unless/until a shared Socket.io adapter and shared classroom state store are introduced. WebRTC relay signaling and active-teacher tracking otherwise cannot coordinate across multiple replicas.

## References

[1] [Prisma — Deploy to Railway](https://www.prisma.io/docs/orm/prisma-client/deployment/traditional/deploy-to-railway)  
[2] [Railway Docs — PostgreSQL](https://docs.railway.com/databases/postgresql)  
[3] [Railway Docs — CLI](https://docs.railway.com/cli)
