export type Lang =
  | "da"
  | "no"
  | "sv"
  | "de"
  | "en"
  | "fr"
  | "it"
  | "es"
  | "pt"
  | "ar";

export type PantryKey =
  | "salt"
  | "pepper"
  | "oil"
  | "butter"
  | "vinegar"
  | "soy_sauce"
  | "honey"
  | "sugar"
  | "flour"
  | "rice"
  | "pasta"
  | "oats"
  | "breadcrumbs"
  | "tomato_paste"
  | "canned_tomatoes"
  | "coconut_milk"
  | "mustard"
  | "ketchup"
  | "mayo"
  | "garlic_powder"
  | "paprika"
  | "cumin"
  | "curry"
  | "chili_flakes"
  | "oregano"
  | "basil"
  | "thyme"
  | "rosemary"
  | "cinnamon"
  | "vanilla_sugar";

export const PANTRY_KEYS: PantryKey[] = [
  "salt","pepper","oil","butter","vinegar","soy_sauce","honey","sugar","flour",
  "rice","pasta","oats","breadcrumbs","tomato_paste","canned_tomatoes","coconut_milk",
  "mustard","ketchup","mayo","garlic_powder","paprika","cumin","curry","chili_flakes",
  "oregano","basil","thyme","rosemary","cinnamon","vanilla_sugar"
];

export const PANTRY_LABELS: Record<Lang, Record<PantryKey, string>> = {
  da: {
    salt:"Salt", pepper:"Peber", oil:"Olie (neutral/oliven)", butter:"Smør", vinegar:"Eddike",
    soy_sauce:"Sojasauce", honey:"Honning", sugar:"Sukker", flour:"Hvedemel", rice:"Ris", pasta:"Pasta",
    oats:"Havregryn", breadcrumbs:"Rasp", tomato_paste:"Tomatpuré", canned_tomatoes:"Hakkede tomater (dåse)",
    coconut_milk:"Kokosmælk", mustard:"Sennep", ketchup:"Ketchup", mayo:"Mayonnaise", garlic_powder:"Hvidløgspulver",
    paprika:"Paprika", cumin:"Spidskommen", curry:"Karri", chili_flakes:"Chiliflager", oregano:"Oregano",
    basil:"Basilikum", thyme:"Timian", rosemary:"Rosmarin", cinnamon:"Kanel", vanilla_sugar:"Vaniljesukker"
  },
  en: {
    salt:"Salt", pepper:"Black pepper", oil:"Cooking oil (neutral/olive)", butter:"Butter", vinegar:"Vinegar",
    soy_sauce:"Soy sauce", honey:"Honey", sugar:"Sugar", flour:"Wheat flour", rice:"Rice", pasta:"Pasta",
    oats:"Oats", breadcrumbs:"Breadcrumbs", tomato_paste:"Tomato paste", canned_tomatoes:"Canned tomatoes",
    coconut_milk:"Coconut milk", mustard:"Mustard", ketchup:"Ketchup", mayo:"Mayonnaise", garlic_powder:"Garlic powder",
    paprika:"Paprika", cumin:"Cumin", curry:"Curry powder", chili_flakes:"Chili flakes", oregano:"Oregano",
    basil:"Basil", thyme:"Thyme", rosemary:"Rosemary", cinnamon:"Cinnamon", vanilla_sugar:"Vanilla sugar"
  },
  no: {
    salt:"Salt", pepper:"Pepper", oil:"Olje (nøytral/oliven)", butter:"Smør", vinegar:"Eddik",
    soy_sauce:"Soyasaus", honey:"Honning", sugar:"Sukker", flour:"Hvetemel", rice:"Ris", pasta:"Pasta",
    oats:"Havregryn", breadcrumbs:"Brødsmuler", tomato_paste:"Tomatpuré", canned_tomatoes:"Hermetiske tomater",
    coconut_milk:"Kokosmelk", mustard:"Sennep", ketchup:"Ketchup", mayo:"Majones", garlic_powder:"Hvitløkspulver",
    paprika:"Paprika", cumin:"Spisskummen", curry:"Karri", chili_flakes:"Chiliflak", oregano:"Oregano",
    basil:"Basilikum", thyme:"Timian", rosemary:"Rosmarin", cinnamon:"Kanel", vanilla_sugar:"Vaniljesukker"
  },
  sv: {
    salt:"Salt", pepper:"Svartpeppar", oil:"Olja (neutral/oliv)", butter:"Smör", vinegar:"Vinäger",
    soy_sauce:"Sojasås", honey:"Honung", sugar:"Socker", flour:"Vetemjöl", rice:"Ris", pasta:"Pasta",
    oats:"Havregryn", breadcrumbs:"Ströbröd", tomato_paste:"Tomatpuré", canned_tomatoes:"Krossade tomater (burk)",
    coconut_milk:"Kokosmjölk", mustard:"Senap", ketchup:"Ketchup", mayo:"Majonnäs", garlic_powder:"Vitlökspulver",
    paprika:"Paprika", cumin:"Spiskummin", curry:"Curry", chili_flakes:"Chiliflakes", oregano:"Oregano",
    basil:"Basilika", thyme:"Timjan", rosemary:"Rosmarin", cinnamon:"Kanel", vanilla_sugar:"Vaniljsocker"
  },
  de: {
    salt:"Salz", pepper:"Schwarzer Pfeffer", oil:"Öl (neutral/Olive)", butter:"Butter", vinegar:"Essig",
    soy_sauce:"Sojasauce", honey:"Honig", sugar:"Zucker", flour:"Weizenmehl", rice:"Reis", pasta:"Pasta",
    oats:"Haferflocken", breadcrumbs:"Paniermehl", tomato_paste:"Tomatenmark", canned_tomatoes:"Dosentomaten",
    coconut_milk:"Kokosmilch", mustard:"Senf", ketchup:"Ketchup", mayo:"Mayonnaise", garlic_powder:"Knoblauchpulver",
    paprika:"Paprika", cumin:"Kreuzkümmel", curry:"Currypulver", chili_flakes:"Chiliflocken", oregano:"Oregano",
    basil:"Basilikum", thyme:"Thymian", rosemary:"Rosmarin", cinnamon:"Zimt", vanilla_sugar:"Vanillezucker"
  },
  fr: {
    salt:"Sel", pepper:"Poivre noir", oil:"Huile (neutre/olive)", butter:"Beurre", vinegar:"Vinaigre",
    soy_sauce:"Sauce soja", honey:"Miel", sugar:"Sucre", flour:"Farine de blé", rice:"Riz", pasta:"Pâtes",
    oats:"Flocons d’avoine", breadcrumbs:"Chapelure", tomato_paste:"Concentré de tomate", canned_tomatoes:"Tomates en conserve",
    coconut_milk:"Lait de coco", mustard:"Moutarde", ketchup:"Ketchup", mayo:"Mayonnaise", garlic_powder:"Ail en poudre",
    paprika:"Paprika", cumin:"Cumin", curry:"Curry", chili_flakes:"Flocons de piment", oregano:"Origan",
    basil:"Basilic", thyme:"Thym", rosemary:"Romarin", cinnamon:"Cannelle", vanilla_sugar:"Sucre vanillé"
  },
  it: {
    salt:"Sale", pepper:"Pepe nero", oil:"Olio (neutro/oliva)", butter:"Burro", vinegar:"Aceto",
    soy_sauce:"Salsa di soia", honey:"Miele", sugar:"Zucchero", flour:"Farina di grano", rice:"Riso", pasta:"Pasta",
    oats:"Fiocchi d’avena", breadcrumbs:"Pangrattato", tomato_paste:"Concentrato di pomodoro", canned_tomatoes:"Pomodori in scatola",
    coconut_milk:"Latte di cocco", mustard:"Senape", ketchup:"Ketchup", mayo:"Maionese", garlic_powder:"Aglio in polvere",
    paprika:"Paprika", cumin:"Cumino", curry:"Curry", chili_flakes:"Peperoncino in fiocchi", oregano:"Origano",
    basil:"Basilico", thyme:"Timo", rosemary:"Rosmarino", cinnamon:"Cannella", vanilla_sugar:"Zucchero vanigliato"
  },
  es: {
    salt:"Sal", pepper:"Pimienta negra", oil:"Aceite (neutro/oliva)", butter:"Mantequilla", vinegar:"Vinagre",
    soy_sauce:"Salsa de soja", honey:"Miel", sugar:"Azúcar", flour:"Harina de trigo", rice:"Arroz", pasta:"Pasta",
    oats:"Avena", breadcrumbs:"Pan rallado", tomato_paste:"Concentrado de tomate", canned_tomatoes:"Tomate en lata",
    coconut_milk:"Leche de coco", mustard:"Mostaza", ketchup:"Ketchup", mayo:"Mayonesa", garlic_powder:"Ajo en polvo",
    paprika:"Pimentón", cumin:"Comino", curry:"Curry", chili_flakes:"Copos de chile", oregano:"Orégano",
    basil:"Albahaca", thyme:"Tomillo", rosemary:"Romero", cinnamon:"Canela", vanilla_sugar:"Azúcar avainillado"
  },
  pt: {
    salt:"Sal", pepper:"Pimenta-preta", oil:"Óleo/azeite", butter:"Manteiga", vinegar:"Vinagre",
    soy_sauce:"Molho de soja", honey:"Mel", sugar:"Açúcar", flour:"Farinha de trigo", rice:"Arroz", pasta:"Massa",
    oats:"Aveia", breadcrumbs:"Pão ralado", tomato_paste:"Extrato de tomate", canned_tomatoes:"Tomate enlatado",
    coconut_milk:"Leite de coco", mustard:"Mostarda", ketchup:"Ketchup", mayo:"Maionese", garlic_powder:"Alho em pó",
    paprika:"Páprica", cumin:"Cominho", curry:"Caril", chili_flakes:"Flocos de pimenta", oregano:"Orégãos",
    basil:"Manjericão", thyme:"Tomilho", rosemary:"Alecrim", cinnamon:"Canela", vanilla_sugar:"Açúcar baunilhado"
  },
  ar: {
    salt:"ملح", pepper:"فلفل أسود", oil:"زيت (محايد/زيت زيتون)", butter:"زبدة", vinegar:"خل",
    soy_sauce:"صلصة الصويا", honey:"عسل", sugar:"سكر", flour:"دقيق قمح", rice:"أرز", pasta:"مكرونة",
    oats:"شوفان", breadcrumbs:"بقسماط", tomato_paste:"معجون طماطم", canned_tomatoes:"طماطم معلبة",
    coconut_milk:"حليب جوز الهند", mustard:"خردل", ketchup:"كاتشب", mayo:"مايونيز", garlic_powder:"ثوم بودرة",
    paprika:"بابريكا", cumin:"كمون", curry:"مسحوق كاري", chili_flakes:"رقائق فلفل حار", oregano:"أوريغانو",
    basil:"ريحان", thyme:"زعتر", rosemary:"إكليل الجبل", cinnamon:"قرفة", vanilla_sugar:"سكر فانيليا"
  }
};
