require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const OpenAI = require("openai");
const Stripe = require("stripe");
const PDFDocument = require("pdfkit");
const {
  Document,
  Packer,
  Paragraph,
  HeadingLevel
} = require("docx");

const app = express();

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "products.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveProducts(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}

let products = loadProducts();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;


/* =========================
   STRIPE WEBHOOK
========================= */

app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!stripe) {
      return res.status(503).send("Stripe not configured");
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      return res
        .status(400)
        .send(`Webhook Error: ${e.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const id = session.metadata?.product_id;

      if (id && products[id]) {
        products[id].status = "paid";
        products[id].email =
          session.customer_details?.email || "";

        saveProducts(products);
      }
    }

    res.json({ received: true });
  }
);


/* =========================
   MIDDLEWARE
========================= */

app.use(express.json({ limit: "1mb" }));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================
   HELPERS
========================= */

function makeId() {
  return crypto
    .randomBytes(10)
    .toString("hex");
}


/* =========================
   FALLBACK GENERATOR
========================= */

function fallback(p) {
  let sections;

  if (p.format === "Чек-лист") {
    sections = [
      "Подготовка",
      "10 ключевых действий",
      "Проверка результата",
      "Типичные ошибки",
      "Финальный чек-лист"
    ];
  } else if (p.format === "Набор шаблонов") {
    sections = [
      "Как пользоваться набором",
      "Шаблон 1",
      "Шаблон 2",
      "Шаблон 3",
      "Адаптация под себя"
    ];
  } else if (p.format === "Мини-курс")
