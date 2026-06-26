import express from 'express';
import * as redirectController from '../controllers/redirectController.js';
import * as videoDescriptionController from '../controllers/videoDescriptionController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/redirects', redirectController.getAllRedirects);
router.delete('/redirects/:slug', redirectController.deleteRedirect);

// Video description manager list
router.get('/videos', videoDescriptionController.getVideosForDescriptionManager);
router.post('/videos/bulk-generate-descriptions', videoDescriptionController.bulkGenerateDescriptions);
router.post('/videos/bulk-clear-descriptions', videoDescriptionController.bulkClearDescriptions);
router.post('/videos/export-descriptions', videoDescriptionController.exportDescriptions);

// Single video description CRUD + history
router.get('/video-descriptions/:videoId', videoDescriptionController.getVideoDescriptionById);
router.put('/video-descriptions/:videoId', videoDescriptionController.updateVideoDescription);
router.get('/video-descriptions/:videoId/history', videoDescriptionController.getVideoDescriptionHistory);
router.post('/video-descriptions/:videoId/restore/:historyId', videoDescriptionController.restoreVideoDescriptionVersion);
router.delete('/video/:id/description', videoDescriptionController.deleteVideoDescription);

export default router;
