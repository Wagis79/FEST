import dotenv from 'dotenv';
import app from './server';

dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log('\n🌾 FEST - Beslutsstöd för gödselrekommendationer 🌾');
  // eslint-disable-next-line no-console
  console.log('='.repeat(50));
  // eslint-disable-next-line no-console
  console.log(`🚀 Server körs på: http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`📊 API: http://localhost:${PORT}/api`);
  // eslint-disable-next-line no-console
  console.log(`🔧 Admin: http://localhost:${PORT}/admin.html`);
  // eslint-disable-next-line no-console
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
  // eslint-disable-next-line no-console
  console.log('='.repeat(50));
  // eslint-disable-next-line no-console
  console.log('\n✅ Redo att ta emot förfrågningar!\n');
});
