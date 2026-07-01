# คู่มือติดตั้ง A‑Math KOTH Manager ด้วย GitHub + Cloudflare Workers + D1

คู่มือนี้ใช้วิธี **ไม่ต้อง Deploy จากเครื่อง**: เก็บโค้ดไว้บน GitHub แล้วให้ Cloudflare Workers ดึงจาก repository และ deploy อัตโนมัติทุกครั้งที่มีการ push ไปที่ branch `main`.

> ใช้กับโฟลเดอร์โปรเจกต์นี้โดยตรง ซึ่งต้องมีไฟล์ `wrangler.jsonc`, `package.json`, `src/`, `public/` และ `migrations/` อยู่ในระดับบนสุดของ repository

---

## ภาพรวมก่อนเริ่ม

สิ่งที่จะทำมี 7 ขั้นตอน:

1. สร้างฐานข้อมูล D1 ใน Cloudflare
2. ใส่ Database ID ลงใน `wrangler.jsonc`
3. สร้างตารางของระบบด้วย SQL ที่เตรียมไว้
4. อัปโหลดโปรเจกต์ขึ้น GitHub
5. ให้ Cloudflare เชื่อมกับ GitHub repository
6. ตั้งค่า Secret สำหรับผู้ดูแลระบบ
7. ทดสอบการเปิดใช้เว็บแอป

**สิ่งที่ต้องมี**

- บัญชี GitHub
- บัญชี Cloudflare บัญชีเดียวกับที่ต้องการใช้งาน Worker และ D1
- ไฟล์โปรเจกต์ `A-Math_KOTH_Cloudflare_App.zip`
- เบราว์เซอร์บนคอมพิวเตอร์

> ไม่ต้องติดตั้ง Node.js หรือใช้ Command Prompt/Terminal สำหรับวิธีนี้

---

## ขั้นที่ 1: แตกไฟล์และตรวจโฟลเดอร์โปรเจกต์

1. แตกไฟล์ `A-Math_KOTH_Cloudflare_App.zip`
2. เปิดโฟลเดอร์ `amath-koth-cloudflare`
3. ตรวจว่ามีไฟล์/โฟลเดอร์เหล่านี้อยู่ระดับบนสุด:

```text
wrangler.jsonc
package.json
public/
src/
migrations/
tests/
README.md
```

**สำคัญ:** ตอนนำขึ้น GitHub ให้ไฟล์ `wrangler.jsonc` อยู่ที่หน้าแรกของ repository ไม่ใช่อยู่ลึกเป็น `ชื่อ-repo/amath-koth-cloudflare/wrangler.jsonc` เว้นแต่จะตั้งค่า Root directory ใน Cloudflare ให้ตรงกับตำแหน่งนั้น

---

## ขั้นที่ 2: สร้าง Cloudflare D1 Database

1. ลงชื่อเข้าใช้ Cloudflare Dashboard
2. ไปที่ **Storage & Databases** แล้วเลือก **D1 SQL Database**
3. กด **Create database**
4. ตั้งชื่อฐานข้อมูลเป็น:

```text
amath-koth-db
```

5. ตำแหน่งข้อมูล (Location hint) ปล่อยค่าเริ่มต้นได้ หากไม่มีข้อกำหนดเฉพาะขององค์กร
6. กด **Create**
7. เมื่อสร้างเสร็จ ให้คัดลอกค่า **Database ID** เก็บไว้ก่อน โดยมีรูปแบบคล้ายนี้:

```text
12345678-abcd-1234-abcd-1234567890ab
```

> ต้องสร้าง D1 ใน Cloudflare account เดียวกับที่จะนำ Worker ขึ้นใช้งาน

---

## ขั้นที่ 3: เชื่อม Database ID กับโปรเจกต์

เปิดไฟล์ `wrangler.jsonc` ด้วยโปรแกรมแก้ไขข้อความ เช่น VS Code, Notepad++, TextEdit หรือ Notepad

หาโค้ดส่วนนี้:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "amath-koth-db",
    "database_id": "00000000-0000-0000-0000-000000000000",
    "migrations_dir": "migrations"
  }
]
```

แทนที่เฉพาะเลข `database_id` ด้วย Database ID ที่คัดลอกมา เช่น:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "amath-koth-db",
    "database_id": "12345678-abcd-1234-abcd-1234567890ab",
    "migrations_dir": "migrations"
  }
]
```

บันทึกไฟล์

**ห้ามเปลี่ยน `binding` จาก `DB`** เพราะโค้ด backend เรียกฐานข้อมูลด้วยชื่อนี้ (`env.DB`)

> หากตั้งชื่อฐานข้อมูลเป็นชื่ออื่น ให้แก้ `database_name` ให้ตรงด้วย แต่ทางที่ง่ายที่สุดคือใช้ชื่อ `amath-koth-db` ตามคู่มือ

---

## ขั้นที่ 4: สร้างตารางระบบใน D1 Console

ฐานข้อมูลเพิ่งสร้างใหม่จึงยังไม่มีตาราง ให้สร้างเพียงครั้งแรกตามนี้

1. กลับไปที่ Cloudflare Dashboard > **D1 SQL Database**
2. เลือกฐานข้อมูล `amath-koth-db`
3. เปิดแท็บ **Console**
4. เปิดไฟล์ในโปรเจกต์:

```text
migrations/0001_init.sql
```

5. คัดลอก SQL ทั้งหมดในไฟล์ แล้ววางลงใน D1 Console
6. กด **Execute**

เมื่อสำเร็จ ระบบจะสร้างตารางหลัก ได้แก่:

```text
tournaments
teams
rounds
matches
audit_logs
```

### ตรวจสอบว่าตารางถูกสร้างแล้ว

วางคำสั่งนี้ใน D1 Console แล้วกด Execute:

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

ควรเห็นชื่อตาราง `tournaments`, `teams`, `rounds`, `matches` และ `audit_logs`

---

## ขั้นที่ 5: สร้าง GitHub Repository และอัปโหลดโค้ด

### วิธี A — ใช้หน้าเว็บไซต์ GitHub (ไม่ใช้คำสั่ง)

1. เข้า GitHub และกด **New repository**
2. ตั้งชื่อ เช่น:

```text
amath-koth-manager
```

3. เลือก Public หรือ Private ตามต้องการ
4. **อย่าเลือก** เพิ่ม README, `.gitignore` หรือ License ตอนสร้าง repository เพราะโปรเจกต์นี้มีไฟล์เหล่านี้อยู่แล้ว
5. กด **Create repository**
6. เลือก **Add file > Upload files**
7. ลากไฟล์และโฟลเดอร์ทั้งหมด “ภายในโฟลเดอร์ `amath-koth-cloudflare`” ขึ้นไป
8. ตรวจสอบว่าในหน้าแรกของ repository เห็น `wrangler.jsonc`, `package.json`, `public` และ `src`
9. กด **Commit changes** ไปที่ branch `main`

### วิธี B — ใช้ Git บนเครื่อง (ทางเลือก)

เปิด Terminal ในโฟลเดอร์ `amath-koth-cloudflare` แล้วใช้คำสั่งต่อไปนี้ โดยแทนที่ URL ของ repository ตามของคุณ:

```bash
git init
git add .
git commit -m "Initial A-Math KOTH Manager"
git branch -M main
git remote add origin https://github.com/ชื่อผู้ใช้/amath-koth-manager.git
git push -u origin main
```

### ข้อห้ามเรื่องความลับ

ห้ามนำรหัสผ่านผู้ดูแลหรือค่า `AUTH_SECRET` ไปใส่ใน GitHub

ไฟล์ `.dev.vars` ถูกตั้งค่าให้ Git ไม่ติดตามอยู่แล้ว แต่ควรตรวจอีกครั้งว่าไม่ได้อัปโหลดไฟล์ดังกล่าวโดยไม่ตั้งใจ

---

## ขั้นที่ 6: เชื่อม GitHub Repository กับ Cloudflare Workers

1. เปิด Cloudflare Dashboard
2. ไปที่ **Workers & Pages**
3. กด **Create application**
4. ในส่วน **Import a repository** กด **Get started**
5. เชื่อมบัญชี GitHub ตามหน้าจอ และอนุญาตให้ Cloudflare เข้าถึง repository ที่สร้างไว้
6. เลือก repository `amath-koth-manager`
7. ตั้งค่าหน้า Build ดังนี้:

| รายการ | ค่าที่แนะนำ |
|---|---|
| Worker name | `amath-koth-manager` |
| Production branch | `main` |
| Root directory | เว้นว่าง หรือ `.` หาก `wrangler.jsonc` อยู่หน้าแรกของ repository |
| Build command | เว้นว่าง |
| Deploy command | `npx wrangler deploy` |

8. กด **Save and Deploy**

**สำคัญมาก:** ชื่อ Worker ใน Cloudflare ต้องตรงกับค่าใน `wrangler.jsonc`:

```jsonc
"name": "amath-koth-manager"
```

หากอยากใช้ชื่อ Worker อื่น ให้แก้ค่า `name` ใน `wrangler.jsonc`, commit/push ก่อน แล้วตั้งชื่อเดียวกันในหน้า Cloudflare

หลังการ Deploy สำเร็จ จะได้ URL ประมาณนี้:

```text
https://amath-koth-manager.<ชื่อบัญชี>.workers.dev
```

---

## ขั้นที่ 7: ตั้งค่า Secret สำหรับล็อกอินผู้ดูแล

เว็บแอปจะยังไม่พร้อมใช้งานจนกว่าจะตั้งค่า Secret ทั้ง 2 ตัว

1. ไปที่ Cloudflare Dashboard > **Workers & Pages**
2. เลือก Worker `amath-koth-manager`
3. เปิด **Settings > Variables and Secrets** หรือ **Settings > Environment variables** (ชื่อเมนูอาจต่างกันเล็กน้อยตามหน้าตา Dashboard)
4. เพิ่มค่าแบบ **Secret** สำหรับ Production อย่างน้อย 2 รายการ:

| ชื่อ Secret | ค่า |
|---|---|
| `ADMIN_PASSWORD` | รหัสผ่านที่ใช้เข้าสู่ระบบผู้ดูแล เช่น รหัสผ่านยาวที่คาดเดายาก |
| `AUTH_SECRET` | ข้อความสุ่มยาวอย่างน้อย 32 ตัวอักษร ใช้สำหรับลงนาม session |

ตัวอย่างรูปแบบ `AUTH_SECRET`:

```text
8f17c99edbc1be4e8f4b6c537668dc4c12d3d0d398801d32a0ea40bfca7d85f1
```

> ใช้ตัวสร้างรหัสผ่านของ password manager เพื่อสร้างค่า `AUTH_SECRET` จะปลอดภัยกว่า ห้ามใส่สองค่านี้ในไฟล์ `wrangler.jsonc`, GitHub หรือโค้ดหน้าเว็บ

---

## ขั้นที่ 8: ตรวจการเชื่อม D1 Binding

หลัง Deploy แล้ว ให้ตรวจครั้งเดียวว่า Worker เชื่อม D1 ถูกต้อง

1. ไปที่ Worker `amath-koth-manager`
2. เปิดแท็บ **Bindings** หรือดูส่วน Bindings ใน Settings
3. ควรมี D1 binding ดังนี้:

```text
Variable name: DB
Database: amath-koth-db
```

ปกติ Cloudflare จะอ่านค่านี้จาก `wrangler.jsonc` ระหว่าง deploy อยู่แล้ว จึงไม่จำเป็นต้องสร้าง binding ซ้ำผ่านหน้า Dashboard

หากไม่มี binding หรือเลือกฐานข้อมูลผิด ให้กลับไปตรวจ `database_id` ใน `wrangler.jsonc`, commit/push แล้วรอ build ใหม่

---

## ขั้นที่ 9: ทดสอบเว็บแอป

1. เปิด URL `workers.dev` ที่ Cloudflare แสดงหลัง deploy
2. กดเข้าสู่ระบบผู้ดูแล
3. ใส่รหัสจาก `ADMIN_PASSWORD`
4. ระบบต้องแสดงหน้าเริ่มต้นที่ยังไม่มีรายการแข่งขัน ไม่มีทีม และไม่มีผลการแข่งขัน
5. ทดลองสร้างรายการแข่งขัน 1 รายการ เช่น “A-Math KOTH มัธยมต้น 2569”
6. เพิ่มทีมทดสอบ 2–4 ทีม แล้วทดลองสร้างเกมแรก

หลังจากทดสอบ หากไม่ต้องการข้อมูลตัวอย่าง สามารถลบรายการแข่งขันทดสอบจากในระบบ แล้วเริ่มรายการจริงได้

---

## เมื่อต้องการแก้เว็บในอนาคต

### แก้หน้าเว็บหรือระบบทั่วไป

1. แก้ไฟล์ใน GitHub หรือแก้ไฟล์บนเครื่องแล้ว push ไปที่ `main`
2. Cloudflare จะเริ่ม Build และ Deploy ใหม่ให้อัตโนมัติ
3. ตรวจผลได้ที่ Worker > **Deployments** หรือ **Build history**

ตัวอย่างไฟล์ที่มักแก้:

```text
public/index.html     โครงหน้าเว็บ
public/styles.css     รูปแบบ/สี/การจัดวาง
public/app.js         การทำงานฝั่งหน้าเว็บ
src/worker.js         API และกระบวนการแข่งขัน
src/core.js           กติกา การคิดคะแนน และจับคู่ KOTH
```

### เมื่อมีการแก้โครงสร้างฐานข้อมูล

การ push โค้ดอย่างเดียว **ไม่ทำให้ SQL ใน `migrations/` ถูก execute อัตโนมัติ** ในแนวทาง Dashboard-only นี้

เมื่อมีไฟล์ migration ใหม่ เช่น:

```text
migrations/0002_add_feature.sql
```

ให้ทำตามลำดับนี้:

1. เปิดไฟล์ SQL ใหม่
2. ไปที่ D1 Database > Console
3. วางและ Execute SQL นั้น **เพียงครั้งเดียว**
4. จากนั้น commit/push โค้ดที่ใช้ตารางหรือคอลัมน์ใหม่นั้น

ควรสร้าง/ปรับตารางใน D1 ก่อน push โค้ดที่อ้างอิงโครงสร้างใหม่ เพื่อไม่ให้แอปเวอร์ชันใหม่เรียกตารางหรือคอลัมน์ที่ยังไม่มี

---

## เชื่อมโดเมนของโรงเรียน (ทางเลือก)

เมื่อระบบทำงานบน `workers.dev` แล้ว สามารถผูกโดเมนจริง เช่น:

```text
amath.ชื่อโรงเรียน.ac.th
```

โดยไปที่ Worker > **Settings > Domains & Routes** แล้วเลือกเพิ่ม Custom Domain

โดเมนควรถูกจัดการ DNS อยู่ใน Cloudflare account เดียวกัน เพื่อให้การตั้งค่าทำได้ง่ายที่สุด

---

## ปัญหาที่พบบ่อย

### 1) Build ขึ้นว่า Worker name ไม่ตรง

**สาเหตุ:** ชื่อ Worker ใน Cloudflare ไม่ตรงกับ `name` ใน `wrangler.jsonc`

**วิธีแก้:** ใช้ชื่อ `amath-koth-manager` ทั้งสองจุด หรือแก้ชื่อในไฟล์แล้ว commit/push ใหม่

### 2) เปิดเว็บได้ แต่ขึ้น `no such table: tournaments`

**สาเหตุ:** ยังไม่ได้ execute ไฟล์ `migrations/0001_init.sql` ใน D1 Console

**วิธีแก้:** ทำขั้นที่ 4 ให้ครบ แล้วเปิดเว็บใหม่

### 3) ขึ้นปัญหา D1 binding หรือหา Database ไม่พบ

**สาเหตุ:** Database ID ใน `wrangler.jsonc` ไม่ตรง, D1 อยู่คนละ Cloudflare account, หรือชื่อ binding ไม่ใช่ `DB`

**วิธีแก้:** ตรวจค่า `database_id`, ใช้ account เดียวกัน และคงค่า `binding` เป็น `DB`

### 4) เข้าสู่ระบบไม่ได้

**สาเหตุ:** ยังไม่ได้ตั้ง `ADMIN_PASSWORD`, ตั้งเป็น Variable แทน Secret, หรือพิมพ์รหัสไม่ตรง

**วิธีแก้:** ไปที่ Worker Settings แล้วเพิ่ม Secret ชื่อ `ADMIN_PASSWORD` ใหม่

### 5) Push ไป GitHub แล้วหน้าเว็บยังไม่เปลี่ยน

**วิธีแก้:** ตรวจว่า push ไป branch `main`, ดู Worker > Deployments / Build history ว่าสถานะ Success, แล้ว refresh แบบไม่ใช้ cache ในเบราว์เซอร์

---

## สรุปค่าที่ต้องตรงกัน

```text
D1 database name : amath-koth-db
D1 binding       : DB
Worker name      : amath-koth-manager
Git branch       : main
Deploy command   : npx wrangler deploy
```

เมื่อ 5 ค่านี้ถูกต้อง และตั้ง `ADMIN_PASSWORD` กับ `AUTH_SECRET` แล้ว ระบบพร้อมใช้เป็นเว็บแอปจัดการแข่งขัน A‑Math KOTH สำหรับการแข่งขันครั้งต่อไปได้ทันที
