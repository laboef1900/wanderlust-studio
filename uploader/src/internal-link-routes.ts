import type { FastifyReply } from 'fastify';
import { analyzeLinkSelection } from '../../site/src/lib/markdown-link-selection.js';
import { readInternalLinkCatalog } from './internal-links.js';
import { isPlainObject } from './request-guards.js';
import type { ServerContext } from './server-context.js';

const BODY_LIMIT = 1024 * 1024;
const MAX_BODY_CHARS = 100_000;

function invalid(reply: FastifyReply) {
  return reply.code(400).send({ error: 'Invalid link analysis request.' });
}

export function registerInternalLinkRoutes(ctx: ServerContext): void {
  const { app, cfg, language, requireAuth } = ctx;

  app.get<{ Querystring: { locale?: unknown } }>('/internal-links', { preHandler: requireAuth }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const locale = req.query.locale;
    if (locale !== 'de' && locale !== 'en') return reply.code(400).send({ error: 'Choose a link locale.' });
    const mode = await language.get();
    if (!mode.locales.includes(locale)) return reply.code(400).send({ error: 'Choose a link locale.' });
    const catalog = await readInternalLinkCatalog({
      language: mode, posts: cfg.posts, pages: cfg.pages, journeys: cfg.journeys,
    }, locale);
    return reply.send(catalog);
  });

  app.post('/internal-links/analyze', {
    preHandler: requireAuth,
    bodyLimit: BODY_LIMIT,
    onRequest: async (_req, reply) => { reply.header('Cache-Control', 'no-store'); },
  }, async (req, reply) => {
    if (!isPlainObject(req.body)) return invalid(reply);
    const { bodyMarkdown, from, to } = req.body;
    if (typeof bodyMarkdown !== 'string' || bodyMarkdown.length > MAX_BODY_CHARS
      || !Number.isInteger(from) || !Number.isInteger(to)
      || (from as number) < 0 || (from as number) >= (to as number) || (to as number) > bodyMarkdown.length) {
      return invalid(reply);
    }
    return reply.send(analyzeLinkSelection(bodyMarkdown, from as number, to as number));
  });
}
