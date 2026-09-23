import os
import qrcode
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

# 1. Colors palette (Aerospace Dark Minimalist)
COLOR_BG = RGBColor(6, 10, 18)          # #060a12 (Deep Space)
COLOR_CARD = RGBColor(14, 22, 36)       # #0e1624 (Card Background)
COLOR_CARD_BORDER = RGBColor(30, 48, 76)# #1e304c
COLOR_CYAN = RGBColor(56, 189, 248)     # #38bdf8 (Accent Cyan)
COLOR_EMERALD = RGBColor(16, 185, 129)  # #10b981 (Success Green)
COLOR_AMBER = RGBColor(251, 191, 36)    # #fbbf24 (Warning Amber)
COLOR_TEXT_WHITE = RGBColor(241, 245, 249) # #f1f5f9
COLOR_TEXT_MUTED = RGBColor(148, 163, 184) # #94a3b8
COLOR_RED = RGBColor(239, 68, 68)       # #ef4444

def set_slide_bg(slide):
    background = slide.background
    fill = background.fill
    fill.solid()
    fill.fore_color.rgb = COLOR_BG

def add_header(slide, eyebrow_text, title_text):
    # Eyebrow
    tb_eye = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(0.35))
    tf_eye = tb_eye.text_frame
    tf_eye.word_wrap = True
    tf_eye.margin_left = tf_eye.margin_top = tf_eye.margin_right = tf_eye.margin_bottom = 0
    p_eye = tf_eye.paragraphs[0]
    p_eye.text = eyebrow_text.upper()
    p_eye.font.size = Pt(11)
    p_eye.font.bold = True
    p_eye.font.color.rgb = COLOR_CYAN

    # Title
    tb_title = slide.shapes.add_textbox(Inches(0.8), Inches(0.75), Inches(11.7), Inches(0.7))
    tf_title = tb_title.text_frame
    tf_title.word_wrap = True
    tf_title.margin_left = tf_title.margin_top = tf_title.margin_right = tf_title.margin_bottom = 0
    p_title = tf_title.paragraphs[0]
    p_title.text = title_text
    p_title.font.size = Pt(26)
    p_title.font.bold = True
    p_title.font.color.rgb = COLOR_TEXT_WHITE

def create_deck():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Temporary directory for QR codes
    qr_dir = "solution/pitch_assets"
    os.makedirs(qr_dir, exist_ok=True)

    url_site = "https://colorado-bytes-aerospace-eric.trycloudflare.com"
    url_repo = "https://gitverse.ru/hackrus.experts/kosmo-nizni_vector_72"

    qr_site_path = os.path.join(qr_dir, "qr_site.png")
    qr_repo_path = os.path.join(qr_dir, "qr_repo.png")

    # Generate QR codes
    qr1 = qrcode.QRCode(box_size=10, border=2)
    qr1.add_data(url_site)
    qr1.make(fit=True)
    img1 = qr1.make_image(fill_color="#060a12", back_color="#38bdf8")
    img1.save(qr_site_path)

    qr2 = qrcode.QRCode(box_size=10, border=2)
    qr2.add_data(url_repo)
    qr2.make(fit=True)
    img2 = qr2.make_image(fill_color="#060a12", back_color="#ffffff")
    img2.save(qr_repo_path)

    # -------------------------------------------------------------
    # СЛАЙД 1: Титул и Кровоточащая боль Арктики (0:00 - 0:30)
    # -------------------------------------------------------------
    s1 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s1)

    # Eyebrow / Tag
    tb = s1.shapes.add_textbox(Inches(0.8), Inches(0.8), Inches(11.7), Inches(0.4))
    p = tb.text_frame.paragraphs[0]
    p.text = "КОСМОХАКАТОН 2026 // КЕЙС 02 · РОСКОСМОС"
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = COLOR_CYAN

    # Main Headline
    tb = s1.shapes.add_textbox(Inches(0.8), Inches(1.3), Inches(11.7), Inches(1.2))
    p = tb.text_frame.paragraphs[0]
    p.text = "ПОЛЮС · Орбитальная лаборатория"
    p.font.size = Pt(40)
    p.font.bold = True
    p.font.color.rgb = COLOR_TEXT_WHITE

    tb_sub = s1.shapes.add_textbox(Inches(0.8), Inches(2.5), Inches(11.7), Inches(0.5))
    p_sub = tb_sub.text_frame.paragraphs[0]
    p_sub.text = "На краю Земли. В центре связи — устойчивая космическая сеть для Северного морского пути."
    p_sub.font.size = Pt(18)
    p_sub.font.color.rgb = COLOR_TEXT_MUTED

    # 3 Pain Cards (Grid)
    cards = [
        ("❌ НЕТ КАБЕЛЕЙ И ВЫШЕК", "Дрейфующие льды и вечная мерзлота делают оптоволокно невозможным. Сотовых вышек в ледяном океане нет.", COLOR_RED),
        ("❌ ГЕОСТАЦИОНАРЫ СЛЕПЫ", "Спутники на высоте 36 000 км висят над экватором. В широтах >70°N они скрываются за горизонтом (угол <10°).", COLOR_AMBER),
        ("❌ «СЛЕПЫЕ ЗОНЫ» ДО 14 ЧАСОВ", "Танкеры СПГ и атомные ледоколы неделями идут без интернета и льдопроходимой навигации. Риск катастроф.", COLOR_RED),
    ]

    left_start = Inches(0.8)
    card_w = Inches(3.64)
    gap = Inches(0.38)
    top_pos = Inches(3.4)
    card_h = Inches(2.8)

    for i, (head, desc, col) in enumerate(cards):
        x = left_start + i * (card_w + gap)
        # Card shape
        shape = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, top_pos, card_w, card_h)
        shape.fill.solid()
        shape.fill.fore_color.rgb = COLOR_CARD
        shape.line.color.rgb = COLOR_CARD_BORDER
        shape.line.width = Pt(1.5)

        tb = s1.shapes.add_textbox(x + Inches(0.25), top_pos + Inches(0.25), card_w - Inches(0.5), card_h - Inches(0.5))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = head
        p1.font.size = Pt(14)
        p1.font.bold = True
        p1.font.color.rgb = col
        p1.space_after = Pt(14)

        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.size = Pt(13)
        p2.font.color.rgb = COLOR_TEXT_WHITE

    # Bottom footer info
    tb_foot = s1.shapes.add_textbox(Inches(0.8), Inches(6.5), Inches(11.7), Inches(0.4))
    p_foot = tb_foot.text_frame.paragraphs[0]
    p_foot.text = "Команда: Точка Лагранжа / Нижний Вектор 72  •  Решение: 48 спутников LEO (550 км, накл. 87°) с лазерными линиями ISL"
    p_foot.font.size = Pt(12)
    p_foot.font.color.rgb = COLOR_CYAN

    # -------------------------------------------------------------
    # СЛАЙД 2: Мостик в Demo (0:30 - 0:40) — БАМ, переходим в софт!
    # -------------------------------------------------------------
    s2 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s2)
    add_header(s2, "ИНТЕРАКТИВНОЕ РЕШЕНИЕ", "Хватит слайдов. Давайте проверим сеть вживую прямо сейчас!")

    # Left Column: Points to show in demo
    tb_left = s2.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(5.2), Inches(4.8))
    tf_left = tb_left.text_frame
    tf_left.word_wrap = True

    p = tf_left.paragraphs[0]
    p.text = "Что мы покажем за следующие 90 секунд:"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = COLOR_CYAN
    p.space_after = Pt(14)

    steps = [
        ("1. 3D-Земля и орбитальная группировка", "48 малых спутников на высоте 550 км с приполярным охватом широт 65°–72°N."),
        ("2. Сквозной лазерный маршрут (ISL)", "Кликаем на терминал Урал-Север: сигнал мгновенно передается через космос на Шлюз в Мурманске за 8.2 мс."),
        ("3. Стресс-тест: авария спутника прямо в полете", "Нажимаем «💥 Отключить спутник» — сеть мгновенно перенаправляет трафик по резервному обходному пути за 0 мс!"),
        ("4. Сравнение очередей (16 vs 48 КА)", "Наглядная дельта: почему 1-я очередь годится только для телеметрии, а 3-я дает связь 24/7.")
    ]

    for title_s, desc_s in steps:
        p_t = tf_left.add_paragraph()
        p_t.text = title_s
        p_t.font.size = Pt(13)
        p_t.font.bold = True
        p_t.font.color.rgb = COLOR_TEXT_WHITE

        p_d = tf_left.add_paragraph()
        p_d.text = desc_s
        p_d.font.size = Pt(11.5)
        p_d.font.color.rgb = COLOR_TEXT_MUTED
        p_d.space_after = Pt(10)

    # Right Column: Screenshot placeholder or embed
    screen_shot = "C:/Users/YVL/.gemini/antigravity/brain/3765dd30-5cf1-4f5b-8377-effab18bbebc/eval_simulator.png"
    if os.path.exists(screen_shot):
        s2.shapes.add_picture(screen_shot, Inches(6.4), Inches(1.8), width=Inches(6.1))
    else:
        # Fallback card
        shape = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.4), Inches(1.8), Inches(6.1), Inches(4.5))
        shape.fill.solid()
        shape.fill.fore_color.rgb = COLOR_CARD

    # -------------------------------------------------------------
    # СЛАЙД 3: Инженерное ядро и Архитектура (2:30 - 3:00)
    # -------------------------------------------------------------
    s3 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s3)
    add_header(s3, "ИНЖЕНЕРНОЕ ЯДРО СИСТЕМЫ", "Математика, алгоритмы и строгая баллистика")

    tech_cards = [
        ("🛰️ БАЛЛИСТИКА И ОРБИТЫ", [
            "Круговые орбиты 550 км, наклонение 87°, 3 плоскости.",
            "Аналитическое Кеплеровское движение во времени.",
            "Переход ECI → ECEF с учетом вращения Земли (Ω_earth).",
            "Расчет зон видимости терминалов (угол места β ≥ 10°)."
        ]),
        ("⚡ ЛАЗЕРНЫЙ БЭКБОН (ISL)", [
            "Межспутниковые оптические каналы связи в вакууме.",
            "Проверка видимости «спутник-спутник» без затенения Землей (R = 6371 км).",
            "Динамический граф контактов на каждом шаге времени.",
            "Скорость передачи со скоростью света (задержка <11 мс)."
        ]),
        ("🧭 ДВЕ СТРАТЕГИИ МАРШРУТИЗАЦИИ", [
            "Min Distance (Dijkstra): минимизация физического расстояния и пинга.",
            "Min Hops (BFS): минимизация числа бортовых переприемов пакетов.",
            "Self-Healing: мгновенный поиск альтернативного обхода при аварии.",
            "Диагностика причин сбоя (NO_CLIENT, ISL_DISCONNECT)."
        ]),
        ("🛡️ АРХИТЕКТУРА И СТАНДАРТЫ", [
            "Полная валидация входной схемы cosmo-A-1.0.",
            "Экспорт официального отчета cosmo-A-result-1.0.",
            "Микросервис FastAPI + NumPy (расчет суток за 0.3 сек).",
            "Развертывание в Docker Compose за 1 команду (100% офлайн)."
        ])
    ]

    t_w = Inches(5.6)
    t_h = Inches(2.2)
    pos = [
        (Inches(0.8), Inches(1.8)),
        (Inches(6.8), Inches(1.8)),
        (Inches(0.8), Inches(4.4)),
        (Inches(6.8), Inches(4.4)),
    ]

    for (x, y), (head, bullet_list) in zip(pos, tech_cards):
        shape = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, t_w, t_h)
        shape.fill.solid()
        shape.fill.fore_color.rgb = COLOR_CARD
        shape.line.color.rgb = COLOR_CARD_BORDER
        shape.line.width = Pt(1.2)

        tb = s3.shapes.add_textbox(x + Inches(0.2), y + Inches(0.15), t_w - Inches(0.4), t_h - Inches(0.3))
        tf = tb.text_frame
        tf.word_wrap = True

        p_h = tf.paragraphs[0]
        p_h.text = head
        p_h.font.size = Pt(13)
        p_h.font.bold = True
        p_h.font.color.rgb = COLOR_CYAN
        p_h.space_after = Pt(6)

        for b in bullet_list:
            p_b = tf.add_paragraph()
            p_b.text = "• " + b
            p_b.font.size = Pt(10.5)
            p_b.font.color.rgb = COLOR_TEXT_WHITE

    # -------------------------------------------------------------
    # СЛАЙД 4: Экономика и Этапы развертывания (3:00 - 3:25)
    # -------------------------------------------------------------
    s4 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s4)
    add_header(s4, "ЭКОНОМИКА И ОБОСНОВАНИЕ РЕКОМЕНДАЦИЙ", "Сравнение этапов развертывания и бизнес-эффект")

    # Table: Stage Comparison
    x_tbl = Inches(0.8)
    y_tbl = Inches(1.8)
    w_tbl = Inches(11.7)
    h_tbl = Inches(2.2)

    rows, cols = 4, 5
    tbl_shape = s4.shapes.add_table(rows, cols, x_tbl, y_tbl, w_tbl, h_tbl)
    tbl = tbl_shape.table

    tbl.columns[0].width = Inches(2.5)
    tbl.columns[1].width = Inches(2.2)
    tbl.columns[2].width = Inches(2.2)
    tbl.columns[3].width = Inches(2.2)
    tbl.columns[4].width = Inches(2.6)

    headers = ["Очередь запуска", "Аппаратов (КА)", "Доступность связи", "Макс. перерыв", "Назначение в отрасли"]
    data = [
        ["1-я очередь (Старт)", "16 аппаратов", "38.6 % – 41.2 %", "40 – 50 минут", "Только пакетная телеметрия"],
        ["2-я очередь (Развитие)", "32 аппарата", "78.4 % – 82.0 %", "12 – 16 минут", "Служебный обмен данными"],
        ["3-я очередь (Полная)", "48 аппаратов", "96.7 % – 98.9 %", "2 – 8 минут", "Непрерывный интернет 24/7"]
    ]

    for c, h in enumerate(headers):
        cell = tbl.cell(0, c)
        cell.fill.solid()
        cell.fill.fore_color.rgb = RGBColor(20, 32, 52)
        p = cell.text_frame.paragraphs[0]
        p.text = h
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = COLOR_CYAN

    for r, row in enumerate(data):
        for c, val in enumerate(row):
            cell = tbl.cell(r + 1, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = COLOR_CARD if r % 2 == 0 else RGBColor(18, 28, 44)
            p = cell.text_frame.paragraphs[0]
            p.text = val
            p.font.size = Pt(11)
            p.font.color.rgb = COLOR_EMERALD if (r == 2 and c == 2) else COLOR_TEXT_WHITE

    # Economic impact cards
    eco_cards = [
        ("42.3 МЛРД ₽", "Предотвращенный ущерб от простоев судов", "Один день простоя каравана танкеров с СПГ во льдах стоит десятки миллионов рублей. Непрерывный мониторинг льдов окупает группировку."),
        ("100% ИМПОРТОНЕЗАВИСИМОСТЬ", "Суверенная космическая инфраструктура", "Полный отказ от зарубежных Iridium/Inmarsat в критически важной стратегической зоне Северного морского пути."),
        ("0 РУБЛЕЙ НА ДОРАБОТКУ MVP", "Готовое рабочее место оператора", "Система уже запущена, валидирована тестами и готова к пилотному внедрению в диспетчерских центрах Роскосмоса.")
    ]

    left_start = Inches(0.8)
    card_w = Inches(3.64)
    gap = Inches(0.38)
    top_pos = Inches(4.3)
    card_h = Inches(2.5)

    for i, (num, sub, txt) in enumerate(eco_cards):
        x = left_start + i * (card_w + gap)
        shape = s4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, top_pos, card_w, card_h)
        shape.fill.solid()
        shape.fill.fore_color.rgb = COLOR_CARD
        shape.line.color.rgb = COLOR_CARD_BORDER
        shape.line.width = Pt(1.5)

        tb = s4.shapes.add_textbox(x + Inches(0.2), top_pos + Inches(0.2), card_w - Inches(0.4), card_h - Inches(0.4))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = num
        p1.font.size = Pt(18)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_CYAN

        p2 = tf.add_paragraph()
        p2.text = sub
        p2.font.size = Pt(11)
        p2.font.bold = True
        p2.font.color.rgb = COLOR_EMERALD
        p2.space_after = Pt(6)

        p3 = tf.add_paragraph()
        p3.text = txt
        p3.font.size = Pt(10)
        p3.font.color.rgb = COLOR_TEXT_MUTED

    # -------------------------------------------------------------
    # СЛАЙД 5: Финал и QR-коды (3:25 - 3:30)
    # -------------------------------------------------------------
    s5 = prs.slides.add_slide(blank_layout)
    set_slide_bg(s5)
    add_header(s5, "ГОТОВЫ К ВНЕДРЕНИЮ", "ПОЛЮС · Система развернута и доступна онлайн")

    # Left Box: QR to Live Website
    x1 = Inches(1.5)
    y1 = Inches(1.8)
    box_w = Inches(4.8)
    box_h = Inches(4.7)

    shape1 = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x1, y1, box_w, box_h)
    shape1.fill.solid()
    shape1.fill.fore_color.rgb = COLOR_CARD
    shape1.line.color.rgb = COLOR_CYAN
    shape1.line.width = Pt(2)

    tb1 = s5.shapes.add_textbox(x1 + Inches(0.3), y1 + Inches(0.2), box_w - Inches(0.6), Inches(0.8))
    p1 = tb1.text_frame.paragraphs[0]
    p1.text = "📲 ЖИВОЙ ВЕБ-СЕРВИС"
    p1.font.size = Pt(16)
    p1.font.bold = True
    p1.font.color.rgb = COLOR_CYAN
    p1.alignment = PP_ALIGN.CENTER

    p1_sub = tb1.text_frame.add_paragraph()
    p1_sub.text = "Отсканируйте с телефона для проверки"
    p1_sub.font.size = Pt(11)
    p1_sub.font.color.rgb = COLOR_TEXT_MUTED
    p1_sub.alignment = PP_ALIGN.CENTER

    s5.shapes.add_picture(qr_site_path, x1 + Inches(1.15), y1 + Inches(1.1), width=Inches(2.5))

    tb1_url = s5.shapes.add_textbox(x1 + Inches(0.2), y1 + Inches(3.8), box_w - Inches(0.4), Inches(0.6))
    p1_url = tb1_url.text_frame.paragraphs[0]
    p1_url.text = url_site
    p1_url.font.size = Pt(9.5)
    p1_url.font.color.rgb = COLOR_TEXT_WHITE
    p1_url.alignment = PP_ALIGN.CENTER

    # Right Box: QR to GitVerse Repo
    x2 = Inches(7.0)
    shape2 = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x2, y1, box_w, box_h)
    shape2.fill.solid()
    shape2.fill.fore_color.rgb = COLOR_CARD
    shape2.line.color.rgb = COLOR_CARD_BORDER
    shape2.line.width = Pt(1.5)

    tb2 = s5.shapes.add_textbox(x2 + Inches(0.3), y1 + Inches(0.2), box_w - Inches(0.6), Inches(0.8))
    p2 = tb2.text_frame.paragraphs[0]
    p2.text = "💻 ИСХОДНЫЙ КОД (GITVERSE)"
    p2.font.size = Pt(16)
    p2.font.bold = True
    p2.font.color.rgb = COLOR_TEXT_WHITE
    p2.alignment = PP_ALIGN.CENTER

    p2_sub = tb2.text_frame.add_paragraph()
    p2_sub.text = "Ветки main и master, Docker, автотесты"
    p2_sub.font.size = Pt(11)
    p2_sub.font.color.rgb = COLOR_TEXT_MUTED
    p2_sub.alignment = PP_ALIGN.CENTER

    s5.shapes.add_picture(qr_repo_path, x2 + Inches(1.15), y1 + Inches(1.1), width=Inches(2.5))

    tb2_url = s5.shapes.add_textbox(x2 + Inches(0.2), y1 + Inches(3.8), box_w - Inches(0.4), Inches(0.6))
    p2_url = tb2_url.text_frame.paragraphs[0]
    p2_url.text = url_repo
    p2_url.font.size = Pt(9.5)
    p2_url.font.color.rgb = COLOR_TEXT_WHITE
    p2_url.alignment = PP_ALIGN.CENTER

    # Bottom CTA bar
    tb_cta = s5.shapes.add_textbox(Inches(0.8), Inches(6.65), Inches(11.7), Inches(0.5))
    p_cta = tb_cta.text_frame.paragraphs[0]
    p_cta.text = "Спасибо за внимание! Команда «Нижний Вектор 72» готова ответить на ваши вопросы."
    p_cta.font.size = Pt(14)
    p_cta.font.bold = True
    p_cta.font.color.rgb = COLOR_EMERALD
    p_cta.alignment = PP_ALIGN.CENTER

    out_file = "solution/POLUS_PITCH_DECK.pptx"
    prs.save(out_file)
    print(f"Presentation successfully saved to: {out_file}")

if __name__ == "__main__":
    create_deck()
