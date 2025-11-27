import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware';
import * as scraperService from '../services/scraper.service';
import { z } from 'zod';
import logger from '../lib/logger';

const router = Router();

const scrapeUrlSchema = z.object({
  url: z.string().url(),
  knowledgeBaseId: z.string(),
});

const scrapeWebsiteSchema = z.object({
  baseUrl: z.string().url(),
  knowledgeBaseId: z.string(),
  maxPages: z.number().min(0).optional(), // 0 = unlimited
});

// Scrape single URL
router.post('/scrape-url', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { url, knowledgeBaseId } = scrapeUrlSchema.parse(req.body);
    
    const result = await scraperService.scrapeWebsite(url, knowledgeBaseId);
    
    res.json({
      success: true,
      data: {
        url: result.url,
        title: result.title,
        type: result.structure.type,
        scrapedAt: result.scrapedAt,
        contentLength: result.content.length,
      },
    });
  } catch (error: any) {
    logger.error('Scrape URL error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Scrape entire website
router.post('/scrape-website', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { baseUrl, knowledgeBaseId, maxPages } = scrapeWebsiteSchema.parse(req.body);
    const userId = req.user?.id;
    
    // Start scraping in background
    res.json({
      success: true,
      message: 'Website scraping started',
      status: 'Processing in background',
    });
    
    // Process asynchronously with real-time updates
    scraperService.scrapeWebsite(baseUrl, knowledgeBaseId, maxPages)
      .then(results => {
        logger.info('Website scraping completed', { baseUrl, pagesScraped: results.length });
      })
      .catch(error => {
        logger.error('Website scraping error', { baseUrl, error: error.message });
      });
    
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    logger.error('Scrape website error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Create scrape job (discover URLs)
router.post('/jobs/create', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { baseUrl, knowledgeBaseId, maxPages } = scrapeWebsiteSchema.parse(req.body);
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const job = await scraperService.createScrapeJob(baseUrl, knowledgeBaseId, userId, maxPages);
    
    res.json({
      success: true,
      job,
    });
  } catch (error: any) {
    logger.error('Create scrape job error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get scrape job status
router.get('/jobs/:jobId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const job = await scraperService.getScrapeJob(req.params.jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(job);
  } catch (error: any) {
    logger.error('Get scrape job error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get all jobs for a knowledge base
router.get('/jobs/kb/:knowledgeBaseId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const jobs = await scraperService.getScrapeJobs(req.params.knowledgeBaseId);
    res.json(jobs);
  } catch (error: any) {
    logger.error('Get scrape jobs error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Start scraping selected URLs
router.post('/jobs/:jobId/start', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { selectedUrls } = req.body;
    
    if (!Array.isArray(selectedUrls)) {
      return res.status(400).json({ error: 'selectedUrls must be an array' });
    }
    
    await scraperService.startScrapingJob(req.params.jobId, selectedUrls);
    
    res.json({
      success: true,
      message: 'Scraping started',
    });
  } catch (error: any) {
    logger.error('Start scraping job error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Get page context (for widget)
router.get('/page-context', async (req, res) => {
  try {
    const { url, knowledgeBaseId } = req.query;
    
    if (!url || !knowledgeBaseId || typeof url !== 'string' || typeof knowledgeBaseId !== 'string') {
      return res.status(400).json({ error: 'url and knowledgeBaseId required' });
    }
    
    const context = await scraperService.getPageContext(url, knowledgeBaseId);
    
    if (!context) {
      return res.json({ 
        found: false,
        message: 'Page not in knowledge base',
      });
    }
    
    res.json({
      found: true,
      content: context.content,
      sources: context.sources,
    });
  } catch (error: any) {
    logger.error('Get page context error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
