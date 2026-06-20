import express from 'express';
import * as captionController from '../controllers/captionController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/:videoId/file', captionController.serveCaptionFile);
router.get('/:videoId', captionController.getCaptions);
router.post('/upload', authenticateToken, captionController.uploadCaption);
router.delete('/:id', authenticateToken, captionController.deleteCaption);

export default router;





