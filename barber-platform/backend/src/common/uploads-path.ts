import { join } from 'path';

export function getUploadsRootDir(): string {
  if (process.env.UPLOADS_DIR) {
    return process.env.UPLOADS_DIR;
  }
  if (process.env.VERCEL) {
    return '/tmp/uploads';
  }
  return join(process.cwd(), 'uploads');
}

export function getStaffUploadsDir(): string {
  return join(getUploadsRootDir(), 'staff');
}

