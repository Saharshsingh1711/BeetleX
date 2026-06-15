import { Router } from 'express';
import multer from 'multer';
import {
  submitProject,
  uploadPitchDeck,
} from '../controllers/projects';
import { authenticate } from '../middlewares/auth';
import { AppError } from '../utils/errors';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new AppError('Bad Request: Only PDF files are allowed for the pitch deck', 400, 'INVALID_FILE_TYPE'));
    }
    cb(null, true);
  },
});

router.post('/:id/submit', authenticate, submitProject);
router.post('/:id/deck', authenticate, upload.single('deck'), uploadPitchDeck);

export default router;
