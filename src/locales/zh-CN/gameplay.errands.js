// 简体中文 — 路边的托付（src/gameplay/errands*.js，数据在 src/data/errands.js）。
// 对白是数据：{ who, text, expr?, act?, choices?, if?, goto?, label? }，由 G.dialogue 逐句播放。
// who：elaina / narrator / 旅人的 id（marta、greta、otto、hanna、tomas、ilse）。全部为本作原创。
export default {
  name: { marta: '玛尔塔', greta: '葛丽塔', otto: '画家奥托', hanna: '牧羊人汉娜', tomas: '车夫托马', ilse: '伊尔泽' },
  title: {
    er_letter: '隔着荒原的信',
    er_hat: '风里的帽子',
    er_stove: '牧羊人的炉子',
    er_ford: '断桥边的南瓜车',
    er_stars: '不肯落下的星星',
  },
  desc: {
    er_letter: '北原农庄的玛尔塔和西原农庄的葛丽塔是一对姐妹，为了一头牛，十二年没说过话。',
    er_hat: '秋千橡树下的画家，帽子被荒原上的风卷走了。',
    er_stove: '岩岭上的牧羊人石屋，炉子在昨夜的雨里熄了。',
    er_ford: '溪上的桥塌了，浅滩的水又涨了。一车南瓜过不了河。',
    er_stars: '进城的路边祠旁，一位魔女在等一个不会再来的人。',
  },
  steps: {
    er_letter: { offer: '和北原农庄的玛尔塔说话', deliver: '骑扫帚把信送到西原农庄的葛丽塔手里', reply: '把葛丽塔的回信带回北原农庄' },
    er_hat: { offer: '和秋千橡树下的画家说话', chase: '骑扫帚追上被风卷走的帽子（对它吹一阵风，能把它往回拽）', return: '把帽子还给秋千橡树下的画家' },
    er_stove: { offer: '和牧羊人石屋的汉娜说话', light: '用火的魔法点着石屋门口的炉子', warm: '和汉娜说话' },
    er_ford: { offer: '和断桥边的车夫说话', freeze: '用冰的魔法把断桥下游的浅滩冻住', across: '到对岸和托马说话' },
    er_stars: { offer: '和路边祠旁的魔女说话', stars: '在野外拾起迷星，读到漏星魔女的手记（{n}/{need}）', tell: '回到路边祠，把手记念给伊尔泽听' },
  },
  done: {
    er_letter: '回信只有一句。今年秋天，葛丽塔要去北原吃姐姐烤的面包。',
    er_hat: '帽子回到了画家头上。它大概还会再逃一次。',
    er_stove: '炉子烧起来了。汤是咸的，面包是硬的，炉子是暖的。',
    er_ford: '南瓜车过了河。伊蕾娜得到了第二大的南瓜。',
    er_stars: '伊尔泽把空星瓶交给了伊蕾娜，托她带回东边的森林。',
  },
  prompt: { talk: '和{name}说话' },
  marker: { giver: '旅人', hat: '帽子', stove: '炉子', ford: '浅滩', letter: '收信人' },
  toast: {
    accepted: '接下了托付：{title}',
    done: '托付完成：{title}',
    keep: '收下了纪念品：{name}',
    hatOff: '帽子被风卷上了天。骑扫帚追上它——对准它吹一阵风，能把它往回拽。',
    hatGust: '风把帽子兜了回来！',
    hatCaught: '抓住了帽子。',
    hatStuck: '帽子挂在了荒原枯树的树梢上。',
    stoveLit: '炉子噼啪地烧了起来。',
    fordFrozen: '浅滩冻住了。托马推着车上了冰面。',
    fordAcross: '南瓜车过了河。',
    fordMelt: '冰化了，车还没过去。再冻一次吧。',
    starsReady: '读到了漏星魔女的手记。路边祠旁的伊尔泽还在等。',
  },
  keep: {
    recipe: { name: '母亲的面包方子', text: '玛尔塔抄给我的面包方子。背面有一行往右歪的字，墨迹比方子新得多。' },
    sketch: { name: '荒原速写', text: '画家奥托的速写：风里的荒原，三棵枯树，一位正在追帽子的魔女。画得最用心的是帽子。' },
    jar: { name: '空星瓶', text: '伊尔泽托我带回东边森林的玻璃瓶，软木塞上刻着一个 F。口袋会破，瓶子不会。' },
  },
  page: {
    tab: '路边的托付',
    count: '{n}/{of}',
    sub: '旅人们托付的小事。不在主线上，也不会耽误行程——大概。',
    active: '进行中',
    done: '已了',
    open: '尚未接下',
    unknown: '还没遇到的旅人',
    keepHead: '纪念品',
    keepNone: '（还没有收下纪念品。）',
    where: '托付人：{place}',
    here: '{n} 件已了 · {m} 件进行中',
  },
  dlg: {
    // ---- 隔着荒原的信 ----
    er_letter_offer: [
      { who: 'marta', text: '你是骑扫帚的魔女吧？能不能……顺路，替我送一封信？' },
      { who: 'elaina', text: '要看顺不顺路。送到哪里？' },
      { who: 'marta', text: '西边，花谷再往西的那座农庄。我妹妹葛丽塔住在那儿。' },
      { who: 'marta', text: '我们十二年没说过话了。为了一头牛。', expr: 'sorrow' },
      { who: 'elaina', text: '……一头牛。', act: 'think' },
      { who: 'marta', text: '是头很好的牛。它早就不在了，可我们谁都没先开口。' },
      { who: 'narrator', text: '西原农庄远在荒原和岩岭的另一头。走路要两天，骑扫帚只要一会儿。', choices: [{ text: '接下这封信', goto: 'yes' }, { text: '下次吧', goto: 'no' }] },
      { label: 'yes', who: 'marta', text: '信封上的字是我写的，她多半认得。要是她把信扔进炉子……你就当没看见。', do: 'result:yes' },
      { who: 'elaina', text: '扔进炉子的话，我会假装是被风吹进去的。', goto: 'end' },
      { label: 'no', who: 'marta', text: '也是。十二年都等了，不差这几天。' },
    ],
    er_letter_wait: [
      { who: 'marta', text: '信送到了吗？……还没有啊。西原农庄，在花谷的西边。' },
    ],
    er_letter_deliver: [
      { who: 'elaina', text: '是葛丽塔小姐吗？有您的信，从北原农庄来。' },
      { who: 'greta', text: '……玛尔塔的字。她写字还是往右边歪。', expr: 'surprised' },
      { who: 'narrator', text: '葛丽塔读了很久。那封信并没有那么长。' },
      { who: 'greta', text: '她说那头牛是她放跑的。我知道。我一直都知道。', expr: 'sorrow' },
      { who: 'greta', text: '你等一下，我写一句回话。只写一句，写多了她会得意。' },
      { who: 'narrator', text: '回信折成了小小的一块，比来信还小。' },
      { who: 'greta', text: '拜托你了，魔女小姐。路上别拆——拆了也没关系，反正我字写得难看。' },
    ],
    er_letter_greta: [
      { who: 'greta', text: '回信送到了吗？她要是笑了，你别告诉我。' },
    ],
    er_letter_reply: [
      { who: 'elaina', text: '回信。只有一句，她说写多了您会得意。' },
      { who: 'marta', text: '……她就是这样。', act: 'laugh' },
      { who: 'narrator', text: '玛尔塔展开纸看了一眼，又折好，放进围裙的口袋里。' },
      { who: 'marta', text: '她说今年秋天要来吃我烤的面包。用母亲的方子。' },
      { who: 'marta', text: '这个给你，母亲的方子，我抄了一份。走了那么远的路，总该带点什么回去。', expr: 'joy' },
      { who: 'elaina', text: '那我就不客气了。' },
      { who: 'narrator', text: '回信上那一句写的是什么，伊蕾娜并没有偷看——至少，她的旅行手记上是这么写的。' },
    ],
    er_letter_after: [
      { who: 'marta', text: '秋天之前，得先把烤炉修一修。' },
    ],
    // ---- 风里的帽子 ----
    er_hat_offer: [
      { who: 'otto', text: '今天的风真好。适合画画，也适合——' },
      { who: 'narrator', text: '一阵风从荒原上压了过来。', do: 'errand:hatOff' },
      { who: 'otto', text: '我的帽子！', expr: 'surprised', act: 'surprised' },
      { who: 'otto', text: '那顶帽子去过的国家，比我画过的画还多……魔女小姐，你那把扫帚，飞得快吗？' },
      { who: 'elaina', text: '比帽子快一点。' },
    ],
    er_hat_wait: [
      { who: 'otto', text: '它往枯树那边去了！……大概。风说了算。' },
    ],
    er_hat_return: [
      { who: 'elaina', text: '您的帽子。它差一点就去了别的国家。' },
      { who: 'otto', text: '它一直想去。谢谢你。', act: 'laugh' },
      { who: 'otto', text: '刚才你追帽子的样子，我画下来了。线条有点乱——风大。' },
      { who: 'narrator', text: '速写上是荒原、枯树，和一个拼命伸着手的魔女。' },
      { who: 'elaina', text: '画得不错。尤其是那位魔女。' },
    ],
    er_hat_after: [
      { who: 'otto', text: '这次我把帽绳系上了。风还在，画也还没画完。' },
    ],
    // ---- 牧羊人的炉子 ----
    er_stove_offer: [
      { who: 'hanna', text: '哎，路过的魔女？来得正好。' },
      { who: 'hanna', text: '昨夜下了雨，炉子灭了，火绒也湿透了。羊不怕冷，我怕。' },
      { if: '!spell:fire', who: 'elaina', text: '可惜，生火的魔法我还没学会。' },
      { if: '!spell:fire', who: 'hanna', text: '那就等你学会了再来。我和炉子都不走。', goto: 'end' },
      { who: 'elaina', text: '生火的话，我会。', choices: [{ text: '帮她点着炉子', goto: 'yes' }, { text: '下次吧', goto: 'no' }] },
      { label: 'yes', who: 'hanna', text: '炉子就在门口。别烧着我的羊。', do: 'result:yes' },
      { who: 'elaina', text: '我尽量。', goto: 'end' },
      { label: 'no', who: 'hanna', text: '急着赶路啊。也好，岩岭上的天黑得快。' },
    ],
    er_stove_wait: [
      { who: 'hanna', text: '炉子在门口。火的魔法对着它来一下就行。' },
    ],
    er_stove_warm: [
      { who: 'hanna', text: '烧起来了。真好。', expr: 'joy' },
      { who: 'hanna', text: '坐下喝口汤吧——不坐也行，魔女都是急性子。' },
      { who: 'hanna', text: '面包拿去。我烤多了，羊又不吃。' },
      { who: 'narrator', text: '汤是咸的，面包是硬的，炉子是暖的。伊蕾娜觉得，三样里有两样就已经足够了。' },
    ],
    er_stove_after: [
      { who: 'hanna', text: '这回我把火绒收进屋里了。雨要下就下吧。' },
    ],
    // ---- 断桥边的南瓜车 ----
    er_ford_offer: [
      { who: 'tomas', text: '桥塌了，浅滩的水又涨了。我这一车南瓜，今天是过不去了。' },
      { who: 'tomas', text: '驴？去年春天它自己走了。比我有主意。' },
      { if: '!spell:ice', who: 'elaina', text: '我现在还帮不上忙。等我学会冰的魔法吧。' },
      { if: '!spell:ice', who: 'tomas', text: '我不急。南瓜也不急。', goto: 'end' },
      { who: 'elaina', text: '要是把水面冻住呢？' },
      { who: 'tomas', text: '冻住？……魔女小姐，你要是能把这条河冻上，最大的南瓜归你。', choices: [{ text: '把浅滩冻住', goto: 'yes' }, { text: '下次吧', goto: 'no' }] },
      { label: 'yes', who: 'tomas', text: '就在下游那段浅滩，水最平的地方。我把车推过去等着。', do: 'result:yes', goto: 'end' },
      { label: 'no', who: 'tomas', text: '那我再等等。说不定水自己会退。说不定。' },
    ],
    er_ford_wait: [
      { who: 'tomas', text: '浅滩就在下游。冻结实一点——南瓜很重，我也不轻。' },
    ],
    er_ford_across: [
      { who: 'tomas', text: '过来了！车轮在冰上一点都没打滑——好吧，滑了两次。', act: 'laugh' },
      { who: 'tomas', text: '说好的，最大的那个。……第二大的那个。最大的我得留着卖。' },
      { who: 'narrator', text: '伊蕾娜收下了第二大的南瓜。她的行囊里，原本没有给南瓜留位置。' },
    ],
    er_ford_after: [
      { who: 'tomas', text: '下回桥修好了，我请你吃南瓜汤。桥大概不会修好。' },
    ],
    // ---- 不肯落下的星星 ----
    er_stars_offer: [
      { who: 'ilse', text: '年轻的魔女。你在野外，见过不肯落下来的星星吗？银色的，停在塔顶、井口、桥洞底下。' },
      { who: 'elaina', text: '远远地见过。一闪一闪的。' },
      { who: 'ilse', text: '很多年前，有人约好在这座小祠前和我碰面。那天她来得很急，口袋空空的。我一直没问为什么。' },
      { who: 'ilse', text: '听说那些星星被同一个人捡到六颗，会让人读到一点东西。要是你读到了，回来念给我听，好吗？', choices: [{ text: '答应她', goto: 'yes' }, { text: '下次吧', goto: 'no' }] },
      { label: 'yes', who: 'ilse', text: '我在这里等。我现在很擅长等。', do: 'result:yes', goto: 'end' },
      { label: 'no', who: 'ilse', text: '没关系。星星不会走，我也不会。' },
    ],
    er_stars_wait: [
      { who: 'ilse', text: '捡到六颗的时候，它们会亮一下。别急，它们比我们有耐心。' },
    ],
    er_stars_tell: [
      { who: 'elaina', text: '星星给我看了一行字。' },
      { who: 'narrator', text: '伊蕾娜念道：{note}' },
      { who: 'ilse', text: '……飞得太急。她总是这样。', expr: 'surprised' },
      { who: 'ilse', text: '那天我说过，正午一过就不等了。她正好在正午落地，气都喘不匀。原来星星是那时候掉的。', expr: 'sorrow' },
      { who: 'narrator', text: '伊蕾娜认得这个字迹。她犹豫了一下，决定还是说出来。' },
      { who: 'elaina', text: '写这行字的人，在东边的森林里住下了，教一个很会读书的女孩魔法。' },
      { who: 'ilse', text: '……她过得好吗？' },
      { who: 'elaina', text: '口袋还是会破。' },
      { who: 'ilse', text: '那就好。', act: 'laugh' },
      { who: 'ilse', text: '这个瓶子，替我还给她。空的——让她这回装满，别再漏了。' },
      { who: 'narrator', text: '伊尔泽没有说那天她们后来去了哪里，伊蕾娜也没有问。进城的路上，风把小祠前的铃铛吹得轻轻响。' },
    ],
    er_stars_after: [
      { who: 'ilse', text: '我再坐一会儿就回城。今天的风，和那天有点像。' },
    ],
  },
};
