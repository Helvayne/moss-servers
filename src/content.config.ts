import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const slug = z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes');
const hostname = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, 'address must be a hostname: no IP address, no port');

const servers = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/servers' }),
  schema: z
    .object({
      name: z.string(),
      order: z.number().int(),
      game: z.enum(['minecraft-java', 'hytale']),
      version: z.string(),
      address: hostname.optional(),
      status: z.enum(['live', 'on-request', 'none', 'hidden']),
      pack: slug.optional(),
      ram: z.string().optional(),
      icon: z.string().regex(/^\/icons\/[\w.-]+\.(png|webp|svg)$/, 'icon must be a file in public/icons/').optional(),
      join: z.array(z.string()).min(1),
      downloads: z.array(z.object({ variant: slug, label: z.string(), note: z.string().optional() })).default([]),
    })
    .refine((d) => d.status !== 'live' || (d.game === 'minecraft-java' && !!d.address), {
      message: 'status: live needs game: minecraft-java and an address',
    })
    .refine((d) => d.downloads.length === 0 || !!d.pack, { message: 'downloads need a pack' }),
});

const changelog = defineCollection({
  loader: glob({ pattern: '*/*.md', base: './src/content/changelog' }),
  schema: z.object({
    server: slug,
    date: z.coerce.date(),
    version: z.string().optional(),
    title: z.string().optional(),
  }),
});

const news = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    servers: z.array(slug).default([]),
  }),
});

const banner = defineCollection({
  loader: glob({ pattern: 'banner.md', base: './src/content/banner' }),
  schema: z.object({ enabled: z.boolean() }),
});

export const collections = { servers, changelog, news, banner };
