/* Deterministic local conversation engine. No network or generated answers. */
var NpcDialogue = (function () {
    "use strict";
    var STYLES = {
        friendly: { label: "친근한 반말", greet: ["안녕, {player}! 나는 {name}야. 만나서 반가워!", "반가워! 나는 {name}야. 무슨 이야기 할까?"], unknown: ["그건 아직 잘 모르겠어. 다른 말로 조금만 더 알려줄래?", "내가 아는 건 소개, 산책, 이 공간 이야기야. 어떤 게 궁금해?"],
            intro: ["나는 {name}야. {personality}", "{name}라고 불러줘! {background}"],
            walk: ["잠깐 산책하고 있었어. 같이 걸을래?", "주변을 둘러보는 중이야. 너도 같이 산책할래?"], yes: ["좋아! 이야기 끝나고 주변을 천천히 둘러보자.", "좋아, 서두르지 말고 쉬엄쉬엄 구경하자!"], no: ["괜찮아! 여기서 잠깐 이야기해도 좋아.", "그럼 잠깐 쉬자. 무슨 이야기를 해볼까?"],
            thanks: ["도움이 됐다니 기뻐!", "언제든 편하게 말 걸어줘."], bye: ["또 만나! 좋은 시간 보내.", "잘 가! 다음에 또 이야기하자."], feeling: ["그랬구나. 지금 마음이 어떤지 조금 더 이야기해 줄래?", "편하게 이야기해도 괜찮아. 무슨 일이 있었어?"],
            book: ["좋아하는 장르부터 이야기해 볼까? 모험, 추리, 편안한 이야기 중에 어떤 게 좋아?"], follow: ["조금 더 궁금한 부분을 구체적으로 말해줄래?", "내가 아는 범위에서 같이 이야기해보자."] },
        polite: { label: "다정한 존댓말", greet: ["안녕하세요, {player}님. 저는 {name}예요. 만나서 반가워요.", "반가워요. 저는 {name}예요. 어떤 이야기를 해볼까요?"], unknown: ["그 내용은 아직 잘 모르겠어요. 조금 다른 표현으로 말씀해 주실래요?", "소개나 산책, 이 공간에 관해서는 이야기할 수 있어요. 어떤 것이 궁금하세요?"],
            intro: ["저는 {name}예요. {personality}", "제 이름은 {name}예요. {background}"], walk: ["주변을 천천히 산책하고 있었어요. 같이 걸으실래요?"], yes: ["좋아요. 이야기를 마친 뒤 주변을 천천히 둘러보세요."], no: ["괜찮아요. 여기서 잠깐 쉬며 이야기해요."],
            thanks: ["도움이 되었다니 기뻐요.", "언제든 편하게 말씀해 주세요."], bye: ["다음에 또 만나요. 편안한 시간 보내세요."], feeling: ["그런 일이 있었군요. 괜찮으시면 조금 더 이야기해 주실래요?"], book: ["어떤 장르를 좋아하세요? 모험, 추리, 편안한 이야기 중에서 골라보셔도 좋아요."], follow: ["어떤 부분이 더 궁금하신가요? 조금 더 구체적으로 말씀해 주세요."] },
        playful: { label: "발랄한 말투", greet: ["짜잔! {name} 등장! {player}, 반가워!", "어서 와, {player}! 나는 {name}야. 오늘은 무슨 이야기 할까?"], unknown: ["앗, 그건 내 대화 노트에 아직 없어! 다른 말로 알려줄래?", "음, 그건 모르겠어! 대신 소개나 산책 이야기는 어때?"],
            intro: ["내 이름은 {name}! {personality}", "나는 {name}야! {background}"], walk: ["다음 산책 코스를 고민 중이었어! 같이 걸을래?"], yes: ["좋아 좋아! 이야기 끝나면 주변부터 구경해보자!"], no: ["좋아, 그럼 쉬는 시간! 여기서 수다 떨자."],
            thanks: ["헤헤, 도움이 됐다니 뿌듯한걸!"], bye: ["다음에 또 놀러 와! 기다릴게!"], feeling: ["그랬구나. 어떤 일이 있었는지 나한테 이야기해줄래?"], book: ["책 이야기 좋지! 모험, 추리, 편안한 이야기 중에 뭐가 끌려?"], follow: ["조금 더 자세히 말해줘! 어떤 부분이 궁금해?"] },
        calm: { label: "차분한 존댓말", greet: ["어서 오세요, {player}님. 저는 {name}입니다.", "반갑습니다. 저는 {name}입니다. 천천히 이야기 나눠요."], unknown: ["제가 아는 이야기에는 없는 내용입니다. 다른 표현으로 말씀해 주시겠어요?", "소개, 산책, 이 공간 안내 중에서 이야기를 이어갈 수 있습니다."],
            intro: ["제 이름은 {name}입니다. {personality}", "저는 {name}입니다. {background}"], walk: ["잠시 주변을 걷고 있었습니다. 함께 걸으시겠어요?"], yes: ["좋습니다. 대화를 마친 뒤 천천히 주변을 둘러보세요."], no: ["알겠습니다. 여기서 잠시 쉬어 가셔도 좋습니다."],
            thanks: ["도움이 되었다니 다행입니다."], bye: ["편안한 시간 보내세요. 다음에 또 뵙겠습니다."], feeling: ["그런 일이 있었군요. 마음이 괜찮으시다면 조금 더 들려주세요."], book: ["좋아하는 이야기의 분위기가 있으신가요? 모험, 추리, 편안한 이야기 중에서 골라보세요."], follow: ["어떤 부분이 궁금하신지 조금 더 구체적으로 말씀해 주세요."] }
    };
    function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function rule(id, title, words, replies, extra) {
        var r = { id: id, title: title, keywords: words, replies: replies, followUps: [], acceptReplies: [], declineReplies: [] };
        if (extra) Object.keys(extra).forEach(function (key) { r[key] = extra[key]; });
        return r;
    }
    function defaults(id, style) {
        style = own(STYLES, style) ? style : "friendly";
        var s = STYLES[style], book = id === "sage";
        return { name: book ? "서가" : "모아", personality: book ? "차분하게 이야기를 듣고 책을 좋아하는 친구예요." : "호기심이 많고 산책과 대화를 좋아하는 친구야.",
            background: "이 공간에서 산책하고 쉬어 가는 친구들과 이야기를 나누고 있어요.",
            style: style, revision: 1, greetings: clone(s.greet), fallbacks: clone(s.unknown), rules: [
                rule("builtin_hello", "인사", ["안녕", "반가워", "반갑", "hello", "hi"], clone(s.greet)),
                rule("builtin_intro", "자기소개", ["누구", "이름", "소개", "넌뭐", "너는뭐"], clone(s.intro), { followUps: clone(s.follow) }),
                rule("builtin_walk", "산책", ["뭐해", "뭐하고", "산책", "걷고", "같이걷"], clone(s.walk), { acceptReplies: clone(s.yes), declineReplies: clone(s.no), followUps: clone(s.follow) }),
                rule("builtin_place", "공간 안내", ["여기어디", "어떤공간", "공간안내", "장소안내", "여기는"], ["{background}"], { followUps: clone(s.follow) }),
                rule("builtin_thanks", "감사", ["고마워", "고맙", "감사", "thanks", "thank you"], clone(s.thanks)),
                rule("builtin_bye", "작별", ["잘가", "잘있어", "안녕히", "다음에봐", "또만나", "bye"], clone(s.bye)),
                rule("builtin_feeling", "마음 이야기", ["슬퍼", "슬프", "속상", "힘들", "외로", "기분"], clone(s.feeling), { followUps: clone(s.feeling) }),
                rule("builtin_book", "책 이야기", ["책추천", "책이야기", "독서", "좋아하는책", "읽을책"], clone(s.book), { followUps: clone(s.follow) })
            ] };
    }
    function text(v, max) { return typeof v === "string" && v.trim().length > 0 && v.length <= max; }
    function list(v, min, max, length) {
        return Array.isArray(v) && v.length >= min && v.length <= max && v.every(function (x) { return text(x, length); });
    }
    function validate(input) {
        if (!input || typeof input !== "object" || !text(input.name, 40) || !text(input.personality, 500) || !text(input.background, 1000) ||
            !own(STYLES, input.style) || !list(input.greetings, 1, 8, 500) || !list(input.fallbacks, 1, 8, 500) ||
            !Array.isArray(input.rules) || input.rules.length > 30) return { error: "이름·성격·배경·인사말·말투를 확인해 주세요." };
        var ids = {}, rules = [];
        for (var i = 0; i < input.rules.length; i++) {
            var r = input.rules[i];
            if (!r || typeof r.id !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(r.id) || own(ids, r.id) || !text(r.title, 40) ||
                !list(r.keywords, 1, 20, 40) || r.keywords.some(function (k) { return compact(k).length < 2; }) ||
                !list(r.replies, 1, 8, 500) || !list(r.followUps || [], 0, 8, 500) || !list(r.acceptReplies || [], 0, 8, 500) || !list(r.declineReplies || [], 0, 8, 500)) {
                return { error: "주제 " + (i + 1) + ": 이름, 중복 ID, 2자 이상 키워드, 답변을 확인해 주세요." };
            }
            if (!!(r.acceptReplies || []).length !== !!(r.declineReplies || []).length) return { error: "동의·거절 답변은 둘 다 입력하거나 둘 다 비워 주세요." };
            ids[r.id] = true;
            rules.push({ id: r.id, title: r.title.trim(), keywords: r.keywords.map(function (x) { return x.trim(); }),
                replies: r.replies.slice(), followUps: (r.followUps || []).slice(), acceptReplies: (r.acceptReplies || []).slice(), declineReplies: (r.declineReplies || []).slice() });
        }
        return { value: { name: input.name.trim(), personality: input.personality.trim(), background: input.background.trim(), style: input.style,
            greetings: input.greetings.slice(), fallbacks: input.fallbacks.slice(), rules: rules, revision: 1 } };
    }
    function normalize(s) {
        if (typeof s.normalize === "function") s = s.normalize("NFKC");
        return s.toLowerCase().replace(/[.,!?~…。，！？ㅋㅎㅠㅜ:;"'“”‘’()[\]{}<>/\\_-]+/g, " ").replace(/\s+/g, " ").trim();
    }
    function compact(s) { return normalize(s).replace(/\s/g, ""); }
    function keywordMatches(message, key) {
        if (/^[a-z0-9 ]+$/i.test(key)) {
            var escaped = normalize(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp("(^|[^a-z0-9])" + escaped + "($|[^a-z0-9])").test(normalize(message));
        }
        return compact(message).indexOf(compact(key)) !== -1;
    }
    function fresh() { return { lastTopic: null, awaiting: null, used: {}, lastIndex: {}, unknown: 0 }; }
    function pick(values, key, state, random) {
        var used = own(state.used, key) ? state.used[key] : [], last = state.lastIndex[key];
        if (used.length >= values.length) used = [];
        var choices = [];
        for (var i = 0; i < values.length; i++) if (used.indexOf(i) < 0 && (values.length === 1 || i !== last)) choices.push(i);
        if (!choices.length) for (var j = 0; j < values.length; j++) if (used.indexOf(j) < 0) choices.push(j);
        var index = choices[Math.min(choices.length - 1, Math.floor((random || Math.random)() * choices.length))];
        used.push(index); state.used[key] = used; state.lastIndex[key] = index;
        return values[index];
    }
    function format(s, p, playerName) {
        var vars = { name: p.name, player: playerName || "친구", personality: p.personality, background: p.background };
        return s.replace(/\{(name|player|personality|background)\}/g, function (_, k) { return vars[k]; });
    }
    function greeting(p, state, playerName, random) { return format(pick(p.greetings, "greeting", state, random), p, playerName); }
    function reply(p, message, state, playerName, random) {
        var key = compact(message), current = p.rules.filter(function (r) { return r.id === state.lastTopic; })[0], previous = state.awaiting;
        var yes = ["응", "네", "넵", "좋아", "좋아요", "그래", "그래요", "같이가자", "같이걸을래", "yes", "ok", "okay"];
        var no = ["아니", "아니요", "아니야", "싫어", "싫어요", "괜찮아", "괜찮아요", "다음에", "no"];
        if (current && previous === current.id && (yes.indexOf(key) >= 0 || no.indexOf(key) >= 0)) {
            state.awaiting = null; state.unknown = 0;
            var accepted = yes.indexOf(key) >= 0;
            return format(pick(accepted ? current.acceptReplies : current.declineReplies, current.id + (accepted ? ":yes" : ":no"), state, random), p, playerName);
        }
        if (current && ["더알려줘", "자세히알려줘", "더말해줘", "왜", "왜요", "어떻게", "어떻게요"].indexOf(key) >= 0 && current.followUps.length) {
            state.awaiting = null; state.unknown = 0;
            return format(pick(current.followUps, current.id + ":follow", state, random), p, playerName);
        }
        var best = null, score = -1;
        p.rules.forEach(function (r) { r.keywords.forEach(function (word) {
            var length = compact(word).length;
            if (keywordMatches(message, word) && length > score) { best = r; score = length; }
        }); });
        state.awaiting = null;
        if (best) {
            state.lastTopic = best.id; state.unknown = 0;
            if (best.acceptReplies.length && best.declineReplies.length) state.awaiting = best.id;
            return format(pick(best.replies, best.id, state, random), p, playerName);
        }
        state.unknown++;
        // Unknown messages do not keep an old topic alive indefinitely.
        if (state.unknown >= 2) state.lastTopic = null;
        return format(pick(p.fallbacks, "unknown", state, random), p, playerName);
    }
    return { styles: Object.keys(STYLES).map(function (id) { return { id: id, label: STYLES[id].label }; }),
        defaults: defaults, validate: validate, fresh: fresh, reply: reply, greeting: greeting, clone: clone };
}());
if (typeof module !== "undefined") module.exports = NpcDialogue;
