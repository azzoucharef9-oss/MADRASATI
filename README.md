# أكاديمية التفوق للفيزياء والرياضيات

منصة دروس خصوصية عربية تعمل بـ Node.js وExpress وPrisma وSocket.io وWebRTC، وتضم تسجيل التلاميذ، لوحات للأستاذ والولي، حضوراً، مواداً مرفوعة، دردشة وأسئلة، وسبورة متزامنة.

## تشغيل المعاينة محلياً

تتضمن الحزمة مخطط SQLite مؤقتاً في `prisma/schema.prisma` لتجربة الواجهات سريعاً. انسخ `.env.example` إلى `.env` واضبط `DATABASE_URL="file:./dev.db"` وقيماً محلية آمنة لـ `JWT_SECRET` و`TEACHER_PASSCODE`، ثم نفّذ:

```bash
npm install
npx prisma generate
npx prisma db push
npm start
```

افتح `http://localhost:3000`، ثم سجّل تلميذاً. يمكن دخول الأستاذ باستخدام قيمة `TEACHER_PASSCODE` التي عيّنتها، بينما يدخل الولي برقم هاتف التلميذ المسجل.

## النشر على Railway مع PostgreSQL

> لا تنشر إعداد SQLite أو ملف `.env` المحلي إلى الإنتاج.

1. انسخ `prisma/schema.postgresql.prisma` فوق `prisma/schema.prisma`.
2. أضف PostgreSQL إلى مشروع Railway، ثم اضبط `DATABASE_URL` بالرابط الذي يوفره Railway.
3. اضبط `NODE_ENV=production` و`JWT_SECRET` عشوائياً قوياً و`TEACHER_PASSCODE` سرياً و`CLIENT_ORIGIN` برابط الواجهة المنشورة.
4. نفّذ `npx prisma generate && npx prisma db push` في خدمة Railway أو عبر Railway CLI.
5. شغّل الخدمة بالأمر `npm start`.

## محتوى الحزمة

لا تتضمن الحزمة `node_modules` أو قاعدة SQLite التجريبية أو ملف `.env` المحلي، لأنها ملفات آلة/أسرار قابلة لإعادة الإنشاء. وهي تتضمن كود المصدر و`package-lock.json` وملفي مخطط Prisma وتعليمات متغيرات البيئة.
