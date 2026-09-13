require("dotenv").config();
const express=require("express");
const path=require("path");
const crypto=require("crypto");
const Database=require("better-sqlite3");
const OpenAI=require("openai");
const Stripe=require("stripe");
const PDFDocument=require("pdfkit");
const {Document,Packer,Paragraph,HeadingLevel}=require("docx");

const app=express();
const PORT=process.env.PORT||3000;
const APP_URL=process.env.APP_URL||`http://localhost:${PORT}`;
const db=new Database(path.join(__dirname,"data","app.db"));
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS products(
 id TEXT PRIMARY KEY, email TEXT, plan TEXT, skill TEXT, audience TEXT, outcome TEXT,
 format TEXT, price TEXT, status TEXT DEFAULT 'draft', title TEXT, content TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

const openai=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;

app.post("/webhook/stripe",express.raw({type:"application/json"}),(req,res)=>{
 if(!stripe) return res.status(503).send("Stripe not configured");
 let event;
 try{
   event=stripe.webhooks.constructEvent(req.body,req.headers["stripe-signature"],process.env.STRIPE_WEBHOOK_SECRET);
 }catch(e){return res.status(400).send(`Webhook Error: ${e.message}`)}
 if(event.type==="checkout.session.completed"){
   const s=event.data.object;
   const id=s.metadata?.product_id;
   if(id) db.prepare("UPDATE products SET status='paid', email=? WHERE id=?").run(s.customer_details?.email||"",id);
 }
 res.json({received:true});
});

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

function makeId(){return crypto.randomBytes(10).toString("hex")}
function fallback(p){
 const sections=p.format==="Чек-лист"
 ?["Подготовка","10 ключевых действий","Проверка результата","Типичные ошибки","Финальный чек-лист"]
 :p.format==="Набор шаблонов"
 ?["Как пользоваться набором","Шаблон 1","Шаблон 2","Шаблон 3","Адаптация под себя"]
 :p.format==="Мини-курс"
 ?["Старт и цель","Урок 1 — база","Урок 2 — практика","Урок 3 — закрепление","Домашнее задание","Итог"]
 :["Для кого продукт","Главная система","Пошаговый план","Практика","Типичные ошибки","Чек-лист результата"];
 return {title:`${p.skill}: практический старт для ${p.audience}`,promise:`Помоги ${p.audience} получить результат: ${p.outcome}.`,sections,bonus:`Быстрый чек-лист по теме «${p.skill}».`,posts:["3 ошибки новичков","Что сделать первым шагом","Быстрый чек-лист","Разбор ошибки","До/после","5 минут, которые экономят часы","Мини-инструкция","Что внутри продукта","FAQ","История автора"]};
}
async function generate(p){
 if(!openai) return fallback(p);
 const prompt=`Ты — продуктовый редактор сервиса «Навык → Товар». Создай коммерчески полезную концепцию цифрового продукта на русском языке.
Навык: ${p.skill}
Аудитория: ${p.audience}
Результат: ${p.outcome}
Формат: ${p.format}
Цена: ${p.price}
Верни ТОЛЬКО JSON с ключами title,promise,sections(array of strings),bonus,posts(array of 10 strings),description.
Не давай юридических гарантий, медицинских/финансовых обещаний. Не выдумывай факты автора.`;
 const r=await openai.responses.create({model:process.env.OPENAI_MODEL||"gpt-5.6-luna",input:prompt});
 const text=r.output_text;
 try{return JSON.parse(text)}catch{return fallback(p)}
}

app.post("/api/generate",async(req,res)=>{
 try{
  const {skill,audience,outcome,format,price,plan="FREE",email=""}=req.body;
  if(!skill||!audience||!outcome) return res.status(400).json({error:"Заполните все поля"});
  const p={skill,audience,outcome,format:format||"PDF-гайд",price:price||"$9"};
  const content=await generate(p);
  const id=makeId();
  db.prepare(`INSERT INTO products(id,email,plan,skill,audience,outcome,format,price,title,content) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id,email,plan,skill,audience,outcome,p.format,p.price,content.title,JSON.stringify(content));
  res.json({id,...p,...content,status:plan==="FREE"?"free":"unpaid"});
 }catch(e){console.error(e);res.status(500).json({error:"Не удалось создать продукт"})}
});

app.post("/api/checkout",async(req,res)=>{
 try{
  if(!stripe) return res.status(503).json({error:"Оплата ещё не подключена: добавьте STRIPE_SECRET_KEY"});
  const {productId,plan,email}=req.body;
  const row=db.prepare("SELECT * FROM products WHERE id=?").get(productId);
  if(!row) return res.status(404).json({error:"Продукт не найден"});
  const cents=plan==="BUNDLE"?Number(process.env.BUNDLE_PRICE_CENTS||3900):Number(process.env.PRO_PRICE_CENTS||1900);
  const session=await stripe.checkout.sessions.create({
    mode:"payment",
    customer_email:email||undefined,
    line_items:[{price_data:{currency:process.env.STRIPE_CURRENCY||"usd",product_data:{name:`Навык → Товар — ${plan}`},unit_amount:cents},quantity:1}],
    metadata:{product_id:productId,plan},
    success_url:`${APP_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&product_id=${productId}`,
    cancel_url:`${APP_URL}/?cancelled=1`
  });
  res.json({url:session.url});
 }catch(e){console.error(e);res.status(500).json({error:"Не удалось создать оплату"})}
});

app.get("/api/product/:id", (req,res)=>{
 const row=db.prepare("SELECT id,email,plan,format,price,title,content,status,created_at FROM products WHERE id=?").get(req.params.id);
 if(!row)return res.status(404).json({error:"Не найдено"});
 res.json({...row,content:JSON.parse(row.content)});
});

function pdfBuffer(row){
 return new Promise(resolve=>{
  const doc=new PDFDocument({margin:54});
  const chunks=[];doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));
  const c=JSON.parse(row.content);
  doc.fontSize(24).text(c.title).moveDown();
  doc.fontSize(11).fillColor("#666").text(`Формат: ${row.format} · Цена: ${row.price}`).fillColor("#111").moveDown();
  doc.fontSize(16).text("Обещание продукта").moveDown(0.3);doc.fontSize(11).text(c.promise).moveDown();
  doc.fontSize(16).text("Структура").moveDown(0.3);
  c.sections.forEach((s,i)=>doc.fontSize(11).text(`${i+1}. ${s}`));doc.moveDown();
  doc.fontSize(16).text("Бонус").moveDown(0.3);doc.fontSize(11).text(c.bonus).moveDown();
  doc.fontSize(16).text("10 идей контента").moveDown(0.3);c.posts.forEach((s,i)=>doc.fontSize(11).text(`${i+1}. ${s}`));
  doc.end();
 });
}
async function docxBuffer(row){
 const c=JSON.parse(row.content);
 const children=[new Paragraph({text:c.title,heading:HeadingLevel.TITLE}),new Paragraph(c.promise),new Paragraph({text:"Структура",heading:HeadingLevel.HEADING_1})];
 c.sections.forEach((s,i)=>children.push(new Paragraph(`${i+1}. ${s}`)));
 children.push(new Paragraph({text:"Бонус",heading:HeadingLevel.HEADING_1}),new Paragraph(c.bonus),new Paragraph({text:"10 идей контента",heading:HeadingLevel.HEADING_1}));
 c.posts.forEach((s,i)=>children.push(new Paragraph(`${i+1}. ${s}`)));
 return Packer.toBuffer(new Document({sections:[{children}]}));
}
app.get("/api/product/:id/pdf",async(req,res)=>{
 const row=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);if(!row)return res.sendStatus(404);
 const b=await pdfBuffer(row);res.set({"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="navyk-tovar-${row.id}.pdf"`}).send(b);
});
app.get("/api/product/:id/docx",async(req,res)=>{
 const row=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);if(!row)return res.sendStatus(404);
 const b=await docxBuffer(row);res.set({"Content-Type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","Content-Disposition":`attachment; filename="navyk-tovar-${row.id}.docx"`}).send(b);
});

app.get("/health",(req,res)=>res.json({ok:true,ai:!!openai,payments:!!stripe}));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Навык → Товар: ${APP_URL}`));
