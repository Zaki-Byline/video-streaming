import express from 'express';
import * as redirectController from '../controllers/redirectController.js';
import * as videoDescriptionController from '../controllers/videoDescriptionController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/redirects', redirectController.getAllRedirects);
router.delete('/redirects/:slug', redirectController.deleteRedirect);

router.get('/videos', videoDescriptionController.getVideosForDescriptionManager);
router.post('/videos/bulk-generate-descriptions', videoDescriptionController.bulkGenerateDescriptions);
router.put('/video/:id/description', videoDescriptionController.updateVideoDescription);
router.delete('/video/:id/description', videoDescriptionController.deleteVideoDescription);

export default router;
