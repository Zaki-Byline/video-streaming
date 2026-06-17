import express from 'express';
import * as authController from '../controllers/authController.js';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/session', optionalAuthenticateToken, authController.sessionStatus);
router.get('/verify', authenticateToken, authController.verifyToken);

export default router;





