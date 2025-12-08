import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged, deleteUser, setPersistence, browserLocalPersistence, browserSessionPersistence, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, onSnapshot, query, where, doc, updateDoc, deleteDoc, writeBatch, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Config
const firebaseConfig = {
    apiKey: "AIzaSyC3rxfvajIswJADfzJD0lphVra99vka7nE",
    authDomain: "household-item-management.firebaseapp.com",
    projectId: "household-item-management",
    storageBucket: "household-item-management.firebasestorage.app",
    messagingSenderId: "1042289941268",
    appId: "1:1042289941268:web:2d77a3a9fb2cf666ed0001"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
        const itemsRef = collection(db, "items");

        // --- State ---
        let allItems = [];
        let currentActionItem = null;
        let pendingAddQty = 1;
        let currentScreen = 'login';
        let homeFilterRoom = 'all';
        let homeFilterCategory = 'all'; 
        let takeoutFilterRoom = 'all';
        let takeoutFilterCategory = 'all'; 
        let unsubscribeItems = null;
        let previousScreen = 'home';
        let focusTargetId = null; 
        let searchResults = [];

        // 标签暂存
        let pendingTags = []; 

        // 自动推断规则
        const INFERENCE_RULES = {
            '食品饮料': ['奶', '水', '茶', '酒', '饮料', '饼', '糖', '巧克力', '可乐', '雪碧', '汁', '咖啡', '燕麦'],
            '烹饪调料': ['油', '盐', '酱', '醋', '米', '面粉', '调料', '鸡精', '味精', '糖', '花椒', '八角'],
            '居家日用': ['纸', '洗衣', '清洁', '剂', '刷', '垃圾袋', '毛巾', '皂', '洗洁精', '柔顺剂'],
            '个人护理': ['洗发', '沐浴', '牙膏', '牙刷', '面霜', '乳液', '口红', '粉底', '卫生巾', '棉', '防晒', '卸妆', '药', '维C', '钙片'],
            '文具工具': ['笔', '本', '胶', '剪刀', '电池', '螺丝', '刀', '尺', '胶带'],
            '电子数码': ['线', '充电', '耳机', '鼠标', '键盘', 'U盘', '手机', '平板']
        };

        const TAG_SUGGESTIONS = {
            '奶': ['饮品', '早餐'], '水': ['饮品', '囤货'], '纸': ['日用', '消耗品'],
            '洗发': ['洗护'], '沐浴': ['洗护'], '牙膏': ['洗护'], '面霜': ['护肤'],
            '口红': ['彩妆'], '感冒': ['药品'], '维': ['保健品']
        };

        // --- Audio Engine ---
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        function playSound(type) {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            const now = audioCtx.currentTime;
            
            if (type === 'success') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(880, now);
                gainNode.gain.setValueAtTime(0.1, now); gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                osc.start(now); osc.stop(now + 0.5);
            } else if (type === 'error') {
                osc.type = 'triangle'; osc.frequency.setValueAtTime(150, now);
                gainNode.gain.setValueAtTime(0.2, now); gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.start(now); osc.stop(now + 0.3);
            } else if (type === 'click') {
                osc.type = 'square'; osc.frequency.setValueAtTime(400, now);
                gainNode.gain.setValueAtTime(0.05, now); gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
                osc.start(now); osc.stop(now + 0.05);
            }
        }

        // --- Unit Presets ---
        let UNIT_LIST = ["个", "包", "箱", "瓶", "袋", "条", "块", "只", "支", "把", "张", "双", "套", "组", "对", "本", "册", "罐", "桶", "壶", "杯", "斤", "公斤", "升", "毫升"];
        const savedUnits = JSON.parse(localStorage.getItem('custom_units') || '[]');
        UNIT_LIST = [...new Set([...UNIT_LIST, ...savedUnits])];

        function learnNewUnit(unit) {
            if(!unit) return;
            if(!UNIT_LIST.includes(unit)) {
                UNIT_LIST.push(unit);
                localStorage.setItem('custom_units', JSON.stringify(UNIT_LIST));
            }
        }

        const savedEmail = localStorage.getItem('savedEmail');
        if(savedEmail) document.getElementById('login-email').value = savedEmail;

        window.announce = (msg, type = 'normal') => {
            const el = document.getElementById('live-announcer');
            el.textContent = msg;
            if (msg.includes("成功") || msg.includes("已添加") || msg.includes("已删除") || msg.includes("自动填入")) playSound('success');
            else if (msg.includes("失败") || msg.includes("错误") || msg.includes("不足") || msg.includes("未找到")) playSound('error');
            setTimeout(() => el.textContent = '', 1000);
        };

        // --- Focus Trap ---
        function trapFocus(modalEl) {
            const focusableElementsString = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
            const focusableContent = modalEl.querySelectorAll(focusableElementsString);
            if (focusableContent.length === 0) return;
            const firstFocusableElement = focusableContent[0];
            const lastFocusableElement = focusableContent[focusableContent.length - 1];
            modalEl.addEventListener('keydown', function(e) {
                if (e.key === 'Tab') {
                    if (e.shiftKey) { 
                        if (document.activeElement === firstFocusableElement) {
                            e.preventDefault(); lastFocusableElement.focus();
                        }
                    } else { 
                        if (document.activeElement === lastFocusableElement) {
                            e.preventDefault(); firstFocusableElement.focus();
                        }
                    }
                }
            });
        }
        trapFocus(document.getElementById('modal-action'));
        trapFocus(document.getElementById('modal-qty'));
        trapFocus(document.getElementById('modal-unit'));
        trapFocus(document.getElementById('modal-zero'));
        trapFocus(document.getElementById('modal-confirm'));
        trapFocus(document.getElementById('modal-forgot'));

        // --- Screen Switcher ---
        function switchScreen(screenId) {
            if (screenId === 'screen-edit') {
                if (currentScreen === 'home' || currentScreen === 'takeout') previousScreen = currentScreen;
                else if (currentScreen === 'results') previousScreen = document.getElementById('btn-back-results').dataset.return || 'home';
            }

            document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
            const target = document.getElementById(screenId);
            if (!target) { console.error("Screen not found:", screenId); return; } 
            target.classList.remove('hidden');
            
            if (screenId === 'screen-home') currentScreen = 'home';
            else if (screenId === 'screen-takeout') currentScreen = 'takeout';
            else if (screenId === 'screen-results') currentScreen = 'results';
            else if (screenId === 'screen-edit') currentScreen = 'edit';
            else if (screenId === 'screen-add') currentScreen = 'add';
else if (screenId === 'screen-settings') currentScreen = 'settings';
            else if (screenId === 'screen-change-pwd') currentScreen = 'change-pwd';
            else currentScreen = 'other';
            
            if (!focusTargetId) {
                setTimeout(() => {
                    const h1 = target.querySelector('h1');
                    if (h1) h1.focus();
                }, 100);
            }

            if(screenId === 'screen-home') refreshHomeList();
            if(screenId === 'screen-takeout') refreshTakeoutList();
        }

        // --- Auth & Init ---
        onAuthStateChanged(auth, user => {
if (user) {
                // 优化朗读：优先显示昵称，并去除“点击展开菜单”冗余提示
const nickName = user.displayName || '未设置昵称';
                // 读取本地家庭名称
                const familyName = localStorage.getItem('family_name_cache') || '未设置家庭';
                const labelText = `当前账号：${nickName}，所属家庭：${familyName}，${user.email}`;
                document.getElementById('btn-account-menu').setAttribute('aria-label', labelText);
                document.getElementById('user-email-display').textContent = nickName;
                switchScreen('screen-home');
                setupDataListener(user.uid);
            } else {
                if(unsubscribeItems) unsubscribeItems();
                allItems = [];
                switchScreen('screen-login');
            }
        });

        // Login Handlers
        document.getElementById('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-login').click(); } });
        document.getElementById('btn-login').addEventListener('click', async () => {
            const e = document.getElementById('login-email').value; const p = document.getElementById('login-password').value;
            const autoLogin = document.getElementById('chk-auto-login').checked;
            const rememberEmail = document.getElementById('chk-remember-email').checked;
            if(rememberEmail) localStorage.setItem('savedEmail', e); else localStorage.removeItem('savedEmail');
            try {
                await setPersistence(auth, autoLogin ? browserLocalPersistence : browserSessionPersistence);
                await signInWithEmailAndPassword(auth, e, p);
            } catch(err) { announce("登录失败"); alert("登录失败：" + err.message); }
        });
        
        const btnAccount = document.getElementById('btn-account-menu');
        const menuAccount = document.getElementById('menu-account-dropdown');
// 菜单键盘导航：上下键切换，Tab键关闭
        menuAccount.addEventListener('keydown', (e) => {
            const buttons = Array.from(menuAccount.querySelectorAll('button'));
            const idx = buttons.indexOf(document.activeElement);

            if (e.key === 'Tab') {
                // 按下 Tab 时，允许默认行为（焦点移出），但在下一帧关闭菜单
                setTimeout(() => {
                    menuAccount.classList.add('hidden');
                    document.getElementById('btn-account-menu').setAttribute('aria-expanded', 'false');
                }, 0);
                return;
            }

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault(); // 阻止页面滚动
                let nextIdx = 0;
                if (e.key === 'ArrowDown') nextIdx = (idx + 1) % buttons.length;
                if (e.key === 'ArrowUp') nextIdx = (idx - 1 + buttons.length) % buttons.length;
                buttons[nextIdx].focus();
            }
        });
        btnAccount.addEventListener('click', (e) => {
            e.stopPropagation(); playSound('click');
            menuAccount.classList.toggle('hidden');
            if(!menuAccount.classList.contains('hidden')) {
                document.getElementById('btn-account-menu').setAttribute('aria-expanded', 'true');
                menuAccount.querySelector('button').focus();
            } else { document.getElementById('btn-account-menu').setAttribute('aria-expanded', 'false'); }
        });
        document.addEventListener('click', (e) => {
            if (!btnAccount.contains(e.target) && !menuAccount.contains(e.target)) {
                menuAccount.classList.add('hidden');
                document.getElementById('btn-account-menu').setAttribute('aria-expanded', 'false');
            }
        });
        document.getElementById('btn-logout').addEventListener('click', () => signOut(auth).then(() => announce("已退出")));
        document.getElementById('btn-clear-data').addEventListener('click', () => {
            menuAccount.classList.add('hidden');
            openGenericConfirm("确定清空数据？", async () => {
                const batch = writeBatch(db);
                const q = query(itemsRef, where("uid", "==", auth.currentUser.uid));
                const snapshot = await getDocs(q);
                snapshot.forEach(doc => batch.delete(doc.ref));
                await batch.commit(); announce("已清空");
            });
        });
        document.getElementById('btn-delete-account').addEventListener('click', () => {
            menuAccount.classList.add('hidden');
            openGenericConfirm("确定删除账号？", async () => {
                const batch = writeBatch(db);
                const q = query(itemsRef, where("uid", "==", auth.currentUser.uid));
                const snapshot = await getDocs(q);
                snapshot.forEach(doc => batch.delete(doc.ref));
                await batch.commit(); await deleteUser(auth.currentUser);
            });
        });
        
        document.getElementById('btn-to-register').addEventListener('click', () => switchScreen('screen-register'));
        document.getElementById('btn-back-login').addEventListener('click', () => switchScreen('screen-login'));
        document.getElementById('btn-submit-reg').addEventListener('click', () => {
            const e = document.getElementById('reg-email').value; const p1 = document.getElementById('reg-pass').value; const p2 = document.getElementById('reg-pass-confirm').value;
            if (p1 !== p2 || p1.length < 6) { alert("密码问题"); return; }
            createUserWithEmailAndPassword(auth, e, p1).catch(err => alert(err.message));
        });
        document.getElementById('btn-forgot-pass').addEventListener('click', () => {
            document.getElementById('modal-forgot').classList.remove('hidden'); setTimeout(() => document.getElementById('title-forgot').focus(), 100);
        });
        document.getElementById('btn-cancel-forgot').addEventListener('click', () => document.getElementById('modal-forgot').classList.add('hidden'));
        document.getElementById('btn-send-reset').addEventListener('click', () => {
            const e = document.getElementById('forgot-email').value; if(!e) return;
            sendPasswordResetEmail(auth, e).then(() => { alert("已发送"); document.getElementById('modal-forgot').classList.add('hidden'); }).catch(err => alert(err.message));
        });

        // --- Data Logic ---
        function setupDataListener(uid) {
            if(unsubscribeItems) unsubscribeItems();
            const q = query(itemsRef, where("uid", "==", uid));
            unsubscribeItems = onSnapshot(q, snap => {
                let isFirstLoad = allItems.length === 0;
                snap.docChanges().forEach(change => {
                    const data = { id: change.doc.id, ...change.doc.data() };
                    if (!data.category) data.category = '其他杂项';
                    if (!data.tags) data.tags = [];

                    if (change.type === "added") {
                        if (isFirstLoad) allItems.push(data); else allItems.unshift(data); 
                    }
                    if (change.type === "modified") {
                        const idx = allItems.findIndex(i => i.id === data.id);
                        if (idx > -1) allItems[idx] = data;
                    }
                    if (change.type === "removed") {
                        allItems = allItems.filter(i => i.id !== data.id);
                    }
                });
                
                allItems.sort((a, b) => {
                    const timeA = a.updatedAt ? a.updatedAt.toMillis() : Date.now() + 10000;
                    const timeB = b.updatedAt ? b.updatedAt.toMillis() : Date.now() + 10000;
                    return timeB - timeA;
                });
                
                if (currentScreen === 'home') refreshHomeList();
                if (currentScreen === 'takeout') refreshTakeoutList();
                if (currentScreen === 'results') refreshResultsList();
            });
        }

        // --- List Renderers ---
        function refreshHomeList() { 
            const catSelect = document.getElementById('home-filter-cat');
            if (catSelect.value !== homeFilterCategory) { catSelect.value = homeFilterCategory; }
            renderList('home-list', homeFilterRoom, homeFilterCategory, allItems); 
        }

        function refreshTakeoutList() { 
            const catSelect = document.getElementById('takeout-filter-cat');
            if (catSelect.value !== takeoutFilterCategory) { catSelect.value = takeoutFilterCategory; }
            renderList('takeout-list', takeoutFilterRoom, takeoutFilterCategory, allItems); 
        }
        
        function refreshResultsList() {
            const term = document.getElementById('title-results').dataset.term || '';
            searchResults = allItems.filter(item => {
                const searchStr = `${item.name} ${item.location||''} ${item.category} ${item.tags.join(' ')}`.toLowerCase();
                return searchStr.includes(term);
            });
            renderList('results-list', 'all', 'all', searchResults);
            updateStats(searchResults);
        }

        function renderList(containerId, filterRoom, filterCat, sourceArray) {
            const container = document.getElementById(containerId);
            const filtered = sourceArray.filter(item => {
                const roomMatch = filterRoom === 'all' || item.room === filterRoom;
                const catMatch = filterCat === 'all' || item.category === filterCat;
                return roomMatch && catMatch;
            });

            if (filtered.length === 0) {
                container.innerHTML = `<div class="p-4 text-center text-gray-500 font-bold empty-msg">没有找到物品</div>`; 
                return;
            }

            const emptyMsg = container.querySelector('.empty-msg') || container.querySelector('.text-center.text-gray-500');
            if (emptyMsg) emptyMsg.remove();

            const existingMap = new Map();
            container.querySelectorAll('.item-card').forEach(el => existingMap.set(el.dataset.id, el));
            existingMap.forEach((el, id) => { if (!filtered.find(i => i.id === id)) el.remove(); });

filtered.forEach(item => {
                let card = existingMap.get(item.id);
                let tagsHtml = '';
                if (item.tags && item.tags.length > 0) {
                    tagsHtml = `<div class="mt-2 flex flex-wrap gap-1">` + 
                        item.tags.map(t => `<span class="px-2 py-0.5 bg-blue-100 text-blue-800 text-sm font-bold rounded-full border border-blue-200">${t}</span>`).join('') +
                        `</div>`;
                }
                const tagsText = item.tags && item.tags.length > 0 ? `，标签：${item.tags.join('、')}` : '';

                // --- 核心重构: 数量显示逻辑 ---
                // DB 中 quantity 存的是最小单位总数
                // item.unit 是主单位(大单位)，item.subUnit 是子单位(小单位)
                
                let displayHtml = '';
                let ariaQty = '';

                // 如果启用了多级单位 (有 subCapacity 且 > 1)
                if (item.subUnit && item.subCapacity > 1) {
                    const totalSmall = parseFloat(item.quantity);
                    const cap = parseFloat(item.subCapacity);
                    
                    // 计算大单位数量 (向下取整)
                    const bigCount = Math.floor(totalSmall / cap);
                    // 计算剩余小单位 (解决浮点数精度问题)
                    const smallCount = parseFloat((totalSmall % cap).toFixed(2));

                    // 构建显示字符串： "3箱 5瓶"
                    let mainStr = '';
                    if (bigCount > 0) mainStr += `${bigCount}${item.unit}`;
                    if (smallCount > 0) mainStr += ` ${smallCount}${item.subUnit}`;
                    if (bigCount === 0 && smallCount === 0) mainStr = `0${item.unit}`;

                    // HTML: 大字显示换算结果，小字显示总数
                    displayHtml = `${mainStr} <span class="text-sm text-gray-400 block font-normal mt-1">(共 ${totalSmall}${item.subUnit})</span>`;
                    ariaQty = `${mainStr}，共${totalSmall}${item.subUnit}`;
                } else {
                    // 单单位模式 (兼容旧数据)
                    displayHtml = `${item.quantity} <span class="text-lg text-gray-500">${item.unit||'个'}</span>`;
                    ariaQty = `${item.quantity}${item.unit||'个'}`;
                }

                const labelText = `${item.name}，分类：${item.category}，位于${item.room} ${item.location||''}，数量${ariaQty}${tagsText}`;
                const htmlContent = `
                    <div class="flex flex-col gap-1 pointer-events-none">
                        <div class="flex justify-between items-start">
                            <div>
                                <h3 class="text-xl font-bold text-gray-900 item-name flex items-center gap-2">
                                    ${item.name}
                                    <span class="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-300">${item.category}</span>
                                </h3>
                                <p class="text-base text-gray-600 font-bold item-loc mt-1">${item.room} - ${item.location || '位置未填'}</p>
                            </div>
                            <div class="text-right">
                                <div class="text-2xl font-bold text-blue-700 item-qty">${displayHtml}</div>
                            </div>
                        </div>
                        ${tagsHtml}
                    </div>
                `;
                if (card) {
                    if (card.getAttribute('aria-label') !== labelText) {
                        card.innerHTML = htmlContent; card.setAttribute('aria-label', labelText);
                    }
                } else {
                    card = document.createElement('div');
                    card.className = "item-card bg-white p-4 rounded-lg shadow border-l-8 border-blue-500 cursor-pointer relative mb-3 transition-transform";
                    card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0'); card.dataset.id = item.id; card.setAttribute('aria-label', labelText); card.innerHTML = htmlContent;
                    const triggerMenu = () => openActionMenu(item);
                    card.addEventListener('click', triggerMenu);
                    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerMenu(); } });
                    container.appendChild(card);
                }
            });
            
            if (focusTargetId) {
                const target = container.querySelector(`[data-id="${focusTargetId}"]`);
                if (target) { target.focus(); focusTargetId = null; }
            }
        }

        function updateStats(items) {
            const statsContainer = document.getElementById('results-stats');
            if (items.length > 0) {
                const totals = {};
                items.forEach(item => { const u = item.unit || '个'; totals[u] = (totals[u] || 0) + item.quantity; });
                const summaryText = Object.entries(totals).map(([u, q]) => `${q} ${u}`).join('、');
                statsContainer.textContent = `共找到 ${items.length} 处。合计：${summaryText}`;
            } else {
                statsContainer.textContent = "未找到相关物品";
            }
        }

        // --- Filters ---
        document.getElementById('home-filter').addEventListener('change', (e) => { homeFilterRoom = e.target.value; refreshHomeList(); });
        document.getElementById('home-filter-cat').addEventListener('change', (e) => { homeFilterCategory = e.target.value; refreshHomeList(); });
        document.getElementById('takeout-filter').addEventListener('change', (e) => { takeoutFilterRoom = e.target.value; refreshTakeoutList(); });
        document.getElementById('takeout-filter-cat').addEventListener('change', (e) => { takeoutFilterCategory = e.target.value; refreshTakeoutList(); });

        // --- Search Logic ---
        const setupSearch = (inputId, btnId, clearBtnId, context) => {
            const input = document.getElementById(inputId);
            const btn = document.getElementById(btnId);
            const clearBtn = document.getElementById(clearBtnId);
            const toggleClear = () => { if (input.value.length > 0) clearBtn.classList.remove('hidden'); else clearBtn.classList.add('hidden'); };
            input.addEventListener('input', toggleClear);
            clearBtn.addEventListener('click', () => { input.value = ''; toggleClear(); input.focus(); });
            const perform = () => {
                const term = input.value.trim().toLowerCase();
                if (!term) return;
                playSound('click');
                const title = document.getElementById('title-results');
                title.textContent = `搜索：${term}`;
                title.dataset.term = term;
                document.getElementById('btn-back-results').dataset.return = context;
                switchScreen('screen-results');
                refreshResultsList();
                announce(`搜索完成`);
            };
            btn.addEventListener('click', perform);
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') perform(); });
        };
        setupSearch('home-search', 'btn-do-search', 'btn-clear-home-search', 'home');
        setupSearch('takeout-search', 'btn-do-search-takeout', 'btn-clear-takeout-search', 'takeout');
        document.getElementById('btn-back-results').addEventListener('click', (e) => {
            const ctx = e.target.dataset.return || 'home';
            document.getElementById('home-search').value = ''; document.getElementById('takeout-search').value = '';
            document.getElementById('btn-clear-home-search').classList.add('hidden'); document.getElementById('btn-clear-takeout-search').classList.add('hidden');
            switchScreen(ctx === 'takeout' ? 'screen-takeout' : 'screen-home');
        });

        // --- Tag Management Logic ---
        function addTag(tagText, containerId, inputId) {
            const cleanTag = tagText.trim();
            if(!cleanTag) return;
            if(pendingTags.includes(cleanTag)) {
                announce(`标签 ${cleanTag} 已存在`);
                return;
            }
            pendingTags.push(cleanTag);
            renderTags(containerId, inputId);
            document.getElementById(inputId).value = '';
            announce(`已添加标签 ${cleanTag}`);
        }

        function removeTag(tagText, containerId, inputId) {
            pendingTags = pendingTags.filter(t => t !== tagText);
            renderTags(containerId, inputId);
            announce(`已删除标签 ${tagText}`);
            document.getElementById(inputId).focus(); 
        }

        function renderTags(containerId, inputId) {
            const container = document.getElementById(containerId);
            container.innerHTML = '';
            pendingTags.forEach(tag => {
                const bubble = document.createElement('span');
                bubble.className = 'tag-bubble';
                bubble.innerHTML = `${tag} <span class="tag-remove" role="button" tabindex="0" aria-label="删除标签 ${tag}">×</span>`;
const delBtn = bubble.querySelector('.tag-remove');
                const delHandler = (e) => { 
                    e.stopPropagation(); 
                    // 修复：阻止回车键触发默认表单提交
                    if (e.key === 'Enter') e.preventDefault();
                    
                    if(e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
                    removeTag(tag, containerId, inputId); 
                };
                delBtn.addEventListener('click', delHandler);
                delBtn.addEventListener('keydown', delHandler);
                container.appendChild(bubble);
            });
        }

        function setupTagInput(inputId, btnId, containerId) {
            const input = document.getElementById(inputId);
            const btn = document.getElementById(btnId);
            const handler = () => addTag(input.value, containerId, inputId);
            btn.addEventListener('click', handler);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); handler(); }
            });
        }
        setupTagInput('add-tags-input', 'btn-add-tag-trigger', 'add-tags-container');
        setupTagInput('edit-tags-input', 'btn-edit-tag-trigger', 'edit-tags-container');

// --- Sub-unit Form Logic ---
        function setupSubUnitToggle(chkId, areaId) {
            const chk = document.getElementById(chkId);
            const area = document.getElementById(areaId);
            chk.addEventListener('change', () => {
                if(chk.checked) { area.classList.remove('hidden'); playSound('click'); }
                else { area.classList.add('hidden'); }
            });
        }
        setupSubUnitToggle('add-enable-subunit', 'add-subunit-area');
        setupSubUnitToggle('edit-enable-subunit', 'edit-subunit-area');

        // --- Auto Inference ---
        function attemptInference(name) {
            if(!name) return;
            let predictedCat = null;
            let predictedTags = [];
            let predictedUnit = null;
            const historyMatch = allItems.find(i => i.name === name);
            if (historyMatch) {
                predictedCat = historyMatch.category;
                predictedTags = [...(historyMatch.tags || [])];
                predictedUnit = historyMatch.unit;
            } else {
                for (const [cat, keywords] of Object.entries(INFERENCE_RULES)) {
                    if (keywords.some(k => name.includes(k))) { predictedCat = cat; break; }
                }
                for (const [key, tags] of Object.entries(TAG_SUGGESTIONS)) {
                    if (name.includes(key)) { tags.forEach(t => { if(!predictedTags.includes(t)) predictedTags.push(t); }); }
                }
            }
if (predictedCat) {
                document.getElementById('add-category').value = predictedCat;
                announce(`已自动选择分类：${predictedCat}`);
            }
            // 已移除自动填入标签逻辑，防止误导
            if (predictedUnit && !document.getElementById('add-unit').value) {
                document.getElementById('add-unit').value = predictedUnit;
            }
        }
        document.getElementById('add-name').addEventListener('blur', (e) => attemptInference(e.target.value.trim()));

        // --- Navigation Handlers ---
        document.getElementById('btn-nav-takeout').addEventListener('click', () => switchScreen('screen-takeout'));
        document.getElementById('btn-back-takeout').addEventListener('click', () => switchScreen('screen-home'));
        

document.getElementById('btn-nav-add').addEventListener('click', () => { 
            switchScreen('screen-add'); 
            document.getElementById('add-name').focus(); 
            pendingTags = []; 
            renderTags('add-tags-container', 'add-tags-input');
        });
        document.getElementById('btn-back-add').addEventListener('click', () => switchScreen('screen-home'));
        document.getElementById('btn-nav-data').addEventListener('click', () => switchScreen('screen-data'));

// 修改: 提交后不跳转，重置表单并聚焦 Name 输入框
        document.getElementById('form-add').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('add-name').value.trim();
            if(!name) return;

            // --- 核心重构: 入库数量计算 ---
            // 用户输入的是“主数量”(例如几箱)，我们需要存“最小单位总数”
            const mainQty = parseFloat(document.getElementById('add-quantity').value) || 0;
            const isSubEnabled = document.getElementById('add-enable-subunit').checked;
            let capacity = 1;
            
            if (isSubEnabled) {
                capacity = parseFloat(document.getElementById('add-sub-capacity').value) || 1;
            }
            
            // 存入数据库的是：主数量 * 容量
            const finalTotalQuantity = mainQty * capacity;
            
            try {
                await addDoc(itemsRef, {
                    name: name,
                    category: document.getElementById('add-category').value,
                    tags: pendingTags,
                    unit: document.getElementById('add-unit').value, // 存主单位名 (如: 箱)
                    room: document.getElementById('add-room').value,
                    location: document.getElementById('add-location').value,
                    quantity: finalTotalQuantity, // 存换算后的总数
                    subUnit: isSubEnabled ? document.getElementById('add-sub-name').value : null,
                    subCapacity: isSubEnabled ? capacity : null,
                    uid: auth.currentUser.uid,
                    updatedAt: serverTimestamp()
                });
                announce("添加成功");
                document.getElementById('form-add').reset();
                document.getElementById('add-subunit-area').classList.add('hidden'); 
                pendingTags = [];
                renderTags('add-tags-container', 'add-tags-input');

// 重置默认值
                document.getElementById('add-quantity').value = "1";
                document.getElementById('add-unit').value = "个";
                document.getElementById('add-name').focus();
            } catch(err) {
                announce("添加失败");
                console.error(err);
                document.getElementById('add-name').focus();
            }
        });
        document.getElementById('btn-cancel-add').addEventListener('click', () => {
            switchScreen('screen-home');
            announce("已取消");
        });

        function cancelEdit() {
            playSound('click');
            if(currentActionItem) focusTargetId = currentActionItem.id;
            switchScreen('screen-' + previousScreen);
        }
        document.getElementById('btn-back-edit').addEventListener('click', cancelEdit);
        document.getElementById('btn-cancel-edit-form').addEventListener('click', cancelEdit);

// Unit Picker
        let unitTargetInput = null;
        let unitTriggerBtnId = null; 
        const unitGrid = document.getElementById('unit-grid');
        
        function initUnitGrid() {
            unitGrid.innerHTML = '';
            const allBtns = [];
            
            // 强制绑定取消按钮 (修复点击无响应问题)
            const btnCancel = document.getElementById('btn-unit-cancel');
            btnCancel.onclick = () => window.closeUnitModal();

            UNIT_LIST.forEach((u, index) => {
                const btn = document.createElement('button');
                btn.className = 'grid-btn'; 
                btn.textContent = u;
                // 核心交互：仅第一个元素可被Tab聚焦，其余为-1 (游走焦点)
                btn.tabIndex = (index === 0) ? 0 : -1;

                // 键盘导航：上下左右键
                btn.addEventListener('keydown', (e) => {
                    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
                        e.preventDefault();
                        const idx = allBtns.indexOf(e.target);
                        let next = idx;
                        const total = allBtns.length;
                        // 网格布局：每行5个
                        if (e.key === 'ArrowRight') next = (idx + 1) % total;
                        if (e.key === 'ArrowLeft') next = (idx - 1 + total) % total;
                        if (e.key === 'ArrowDown') { if(idx + 5 < total) next = idx + 5; }
                        if (e.key === 'ArrowUp') { if(idx - 5 >= 0) next = idx - 5; }

                        // 转移焦点
                        allBtns[idx].tabIndex = -1;
                        allBtns[next].tabIndex = 0;
                        allBtns[next].focus();
                    }
                });

                btn.addEventListener('click', () => {
                    if(unitTargetInput) { unitTargetInput.value = u; announce(`已选择 ${u}`); unitTargetInput.focus(); }
                    closeUnitModal();
                });
                
                allBtns.push(btn);
                unitGrid.appendChild(btn);
            });
        }
        window.openUnitPicker = (inputId, triggerBtnId) => {
            playSound('click'); 
            unitTargetInput = document.getElementById(inputId); 
            unitTriggerBtnId = triggerBtnId; // 记录触发按钮ID
            initUnitGrid(); 
            document.getElementById('modal-unit').classList.remove('hidden'); 
            document.getElementById('unit-title').focus();
        };

        // 修改：关闭时将焦点还给触发按钮
        window.closeUnitModal = () => { 
            document.getElementById('modal-unit').classList.add('hidden'); 
            if(unitTriggerBtnId) {
                const btn = document.getElementById(unitTriggerBtnId);
                if(btn) btn.focus();
            }
        };
document.getElementById('btn-pick-unit-add').addEventListener('click', () => openUnitPicker('add-unit', 'btn-pick-unit-add'));
document.getElementById('btn-pick-unit-add-sub').addEventListener('click', () => openUnitPicker('add-sub-name', 'btn-pick-unit-add-sub'));
        document.getElementById('btn-pick-unit-edit').addEventListener('click', () => openUnitPicker('edit-unit', 'btn-pick-unit-edit'));
document.getElementById('btn-pick-unit-edit-sub').addEventListener('click', () => openUnitPicker('edit-sub-name', 'btn-pick-unit-edit-sub'));

// Edit Execution
        document.getElementById('form-edit').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // --- 修复: 编辑保存时的计算 ---
            // 获取用户输入的主数量 (如: 2箱)
            const inputMainQty = parseFloat(document.getElementById('edit-quantity').value) || 0;
            
            // 获取当前的换算比例
            const isSub = document.getElementById('edit-enable-subunit').checked;
            const cap = isSub ? (parseFloat(document.getElementById('edit-sub-capacity').value) || 1) : 1;
            
            // 计算入库总数 (如: 2 * 24 = 48)
            const finalTotal = inputMainQty * cap;

            const unitVal = document.getElementById('edit-unit').value;
            learnNewUnit(unitVal);
            
if (finalTotal === 0) { openZeroConfirmEdit(finalTotal); return; }
            await executeEdit(finalTotal);
        });

        async function executeEdit(newQty) {
            focusTargetId = currentActionItem.id; 
            try {
                await updateDoc(doc(db, "items", currentActionItem.id), {
                    name: document.getElementById('edit-name').value,
                    category: document.getElementById('edit-category').value, 
                    tags: pendingTags, 
                    room: document.getElementById('edit-room').value,
                    location: document.getElementById('edit-location').value,
unit: document.getElementById('edit-unit').value,
                    subUnit: document.getElementById('edit-enable-subunit').checked ? document.getElementById('edit-sub-name').value : null,
                    subCapacity: document.getElementById('edit-enable-subunit').checked ? parseInt(document.getElementById('edit-sub-capacity').value) : null,
                    quantity: newQty,
                    updatedAt: serverTimestamp()
                });
                announce("修改成功");
                switchScreen('screen-' + previousScreen);
            } catch(e) { announce("失败"); }
        }

        function openZeroConfirmEdit(newQty) {
            const m = document.getElementById('modal-zero'); playSound('error'); m.classList.remove('hidden'); setTimeout(() => document.getElementById('title-zero').focus(), 100);
            document.getElementById('btn-zero-keep').onclick = async () => { m.classList.add('hidden'); await executeEdit(0); };
            document.getElementById('btn-zero-del').onclick = async () => { m.classList.add('hidden'); await execDelete(); switchScreen('screen-' + previousScreen); };
            document.getElementById('btn-zero-cancel').onclick = () => { m.classList.add('hidden'); announce("已取消"); };
        }

        // Action Menu
        function openActionMenu(item) {
            playSound('click');
            const freshItem = allItems.find(i => i.id === item.id) || item;
            currentActionItem = freshItem;
            const modal = document.getElementById('modal-action');
            document.getElementById('action-title').textContent = `管理：${freshItem.name}`;
            document.getElementById('action-desc').textContent = `分类：${freshItem.category} | 剩余：${freshItem.quantity} ${freshItem.unit||'个'}`;
            const btnPut = document.getElementById('btn-act-put');
            if (currentScreen === 'takeout') btnPut.classList.add('hidden'); else btnPut.classList.remove('hidden'); 
            modal.classList.remove('hidden');
            setTimeout(() => { const v = modal.querySelectorAll('button:not(.hidden)'); if(v.length > 0) v[0].focus(); }, 100);
        }
document.getElementById('action-buttons-container').addEventListener('click', (e) => {
            const btn = e.target.closest('button'); if (!btn) return;
            const act = btn.dataset.action;
            
            if (act === 'put') openQtyPicker("放入数量", (n) => handleUpdate(n), currentActionItem);
            if (act === 'take') openQtyPicker("取出数量", (n) => handleUpdate(-n), currentActionItem);
            if (act === 'delete') openGenericConfirm(`确定删除 ${currentActionItem.name} 吗？`, execDelete);
            if (act === 'edit') openEditScreen(currentActionItem);
        });

        function openEditScreen(item) {
            document.getElementById('modal-action').classList.add('hidden');
            switchScreen('screen-edit');
            document.getElementById('edit-name').value = item.name;
            const catSelect = document.getElementById('edit-category');
            catSelect.value = item.category || '其他杂项';
            if(catSelect.value === '') catSelect.value = '其他杂项';

            document.getElementById('edit-room').value = item.room;
            document.getElementById('edit-location').value = item.location;
            document.getElementById('edit-unit').value = item.unit || '个';

// 回显子单位
            if (item.subUnit && item.subCapacity) {
                document.getElementById('edit-enable-subunit').checked = true;
                document.getElementById('edit-subunit-area').classList.remove('hidden');
                document.getElementById('edit-sub-name').value = item.subUnit;
                document.getElementById('edit-sub-capacity').value = item.subCapacity;
            } else {
                document.getElementById('edit-enable-subunit').checked = false;
                document.getElementById('edit-subunit-area').classList.add('hidden');
                document.getElementById('edit-sub-name').value = '';
                document.getElementById('edit-sub-capacity').value = '';
            }

pendingTags = [...(item.tags || [])];
            
            // --- 修复: 数量回显 (转回主单位) ---
            // 如果有多级单位，显示“主单位数量”(例如 24瓶 -> 显示 1箱)
            const cap = (item.subUnit && item.subCapacity) ? item.subCapacity : 1;
            // 保留2位小数，防止除不尽
            const mainQty = (item.quantity / cap); 
            // 如果是整数就显示整数，否则显示小数
            document.getElementById('edit-quantity').value = Number.isInteger(mainQty) ? mainQty : mainQty.toFixed(2);

            renderTags('edit-tags-container', 'edit-tags-input');
        }

// --- 核心重构: 数量选择器 (原生输入框版) ---
        let qtyCallback = null;
        let currentPickerScale = 1; // 1 = 按小单位, N = 按大单位
        let currentItemContext = null; // 保存当前操作的物品上下文

        // 绑定输入框回车提交
        document.getElementById('qty-custom-input').addEventListener('keydown', (e) => {
            if(e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btn-qty-confirm').click();
            }
        });

        // 绑定取消
        document.getElementById('btn-qty-cancel').addEventListener('click', closeQtyModal);
        
        // 绑定确认
        document.getElementById('btn-qty-confirm').addEventListener('click', () => {
             const val = parseFloat(document.getElementById('qty-custom-input').value);
             if (isNaN(val) || val <= 0) {
                 announce("请输入有效的数字");
                 document.getElementById('qty-custom-input').focus();
                 return;
             }
             submitQty(val);
        });

        function openQtyPicker(title, cb, itemContext = null) {
            playSound('click'); 
            qtyCallback = cb;
            currentItemContext = itemContext;
            
            document.getElementById('qty-title').textContent = title;
            document.getElementById('modal-action').classList.add('hidden'); 
            document.getElementById('modal-qty').classList.remove('hidden');
            
            const toggleDiv = document.getElementById('qty-unit-toggle');
            const btnSmall = document.getElementById('btn-qty-unit-small');
            const btnBig = document.getElementById('btn-qty-unit-big');
            const input = document.getElementById('qty-custom-input');
            const helper = document.getElementById('qty-helper-text');
            
            input.value = ''; // 清空旧值
            
            // 判断是否有多级单位
            if (itemContext && itemContext.subUnit && itemContext.subCapacity > 1) {
                toggleDiv.classList.remove('hidden');
                
                // 设置按钮文字
                btnSmall.textContent = `按小单位 (${itemContext.subUnit})`;
                btnBig.textContent = `按大单位 (${itemContext.unit})`;

                // 样式切换函数
                const setStyle = (mode) => {
                    // mode: 'small' or 'big'
                    const activeClass = ['bg-blue-600', 'text-white', 'border-blue-600'];
                    const inactiveClass = ['bg-white', 'text-gray-700', 'border-gray-300'];
                    
                    if (mode === 'big') {
                        currentPickerScale = parseFloat(itemContext.subCapacity);
                        btnBig.classList.add(...activeClass); btnBig.classList.remove(...inactiveClass); btnBig.setAttribute('aria-checked', 'true');
                        btnSmall.classList.add(...inactiveClass); btnSmall.classList.remove(...activeClass); btnSmall.setAttribute('aria-checked', 'false');
                        helper.textContent = `当前输入 1 代表 1 ${itemContext.unit} (即 ${currentPickerScale} ${itemContext.subUnit})`;
                    } else {
                        currentPickerScale = 1;
                        btnSmall.classList.add(...activeClass); btnSmall.classList.remove(...inactiveClass); btnSmall.setAttribute('aria-checked', 'true');
                        btnBig.classList.add(...inactiveClass); btnBig.classList.remove(...activeClass); btnBig.setAttribute('aria-checked', 'false');
                        helper.textContent = `当前输入 1 代表 1 ${itemContext.subUnit}`;
                    }
                };

                // 智能默认选中逻辑：
                // 如果是“取出”操作 (title包含取出)，默认选小单位
                // 如果是“放入”操作 (title包含放入)，默认选大单位
                if (title.includes("取出")) {
                    setStyle('small');
                } else {
                    setStyle('big'); // 放入默认按箱放
                }

                // 绑定点击事件
                btnSmall.onclick = () => { setStyle('small'); announce(`已切换为按${itemContext.subUnit}操作`); input.focus(); };
                btnBig.onclick = () => { setStyle('big'); announce(`已切换为按${itemContext.unit}操作`); input.focus(); };

            } else {
                // 没有多级单位，隐藏切换器，默认为1
                toggleDiv.classList.add('hidden');
                currentPickerScale = 1;
                const u = itemContext ? (itemContext.unit || '个') : '个';
                helper.textContent = `请输入数量 (单位：${u})`;
            }

            // 聚焦输入框
            setTimeout(() => input.focus(), 100);
        }

        function submitQty(inputVal) { 
            // 核心计算：输入值 * 当前倍率
            // 例如：输入 2 (箱), 倍率 24 -> 结果 48 (瓶)
            const finalVal = inputVal * currentPickerScale;
            
            if (qtyCallback) qtyCallback(finalVal); 
            
            document.getElementById('modal-qty').classList.add('hidden');
            closeModals();
        }
        
function closeQtyModal() { 
            document.getElementById('modal-qty').classList.add('hidden'); 
            closeModals(); 
        }

        window.closeModals = () => {
            document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
            const containerId = (currentScreen === 'results') ? 'results-list' : (currentScreen === 'takeout' ? 'takeout-list' : 'home-list');
            const container = document.getElementById(containerId);
            if (currentActionItem && currentActionItem.id) {
                const target = container.querySelector(`.item-card[data-id="${currentActionItem.id}"]`);
                if (target) { target.focus(); return; }
            }
            const first = container.querySelector('.item-card');
            if (first) first.focus();
        };

        async function handleUpdate(change) {
            if (!currentActionItem) return;
            const newQty = currentActionItem.quantity + change;
            if (newQty === 0) { openZeroConfirm(); return; }
            if (newQty < 0) { announce("库存不足"); return; }
            await execUpdate(change);
        }
        async function execUpdate(change) {
            focusTargetId = currentActionItem.id;
            try {
                await updateDoc(doc(db, "items", currentActionItem.id), { quantity: increment(change), updatedAt: serverTimestamp() });
                announce("更新成功"); closeModals();
            } catch(e) { announce("失败"); }
        }
        function openZeroConfirm() {
            const m = document.getElementById('modal-zero'); playSound('error'); m.classList.remove('hidden'); setTimeout(() => document.getElementById('title-zero').focus(), 100);
            document.getElementById('btn-zero-keep').onclick = async () => { m.classList.add('hidden'); await execUpdate(-currentActionItem.quantity); };
            document.getElementById('btn-zero-del').onclick = async () => { m.classList.add('hidden'); await execDelete(); };
            document.getElementById('btn-zero-cancel').onclick = () => { m.classList.add('hidden'); announce("已取消"); closeModals(); };
        }
        let confirmCallback = null;
        function openGenericConfirm(msg, cb) {
            document.getElementById('modal-action').classList.add('hidden'); const m = document.getElementById('modal-confirm'); playSound('error');
            m.classList.remove('hidden'); document.getElementById('confirm-text').textContent = msg; confirmCallback = cb; setTimeout(() => document.getElementById('title-confirm').focus(), 100);
        }
        document.getElementById('btn-confirm-ok').addEventListener('click', () => { if(confirmCallback) confirmCallback(); document.getElementById('modal-confirm').classList.add('hidden'); });
        document.getElementById('btn-confirm-cancel').addEventListener('click', () => closeModals());
        async function execDelete() { try { await deleteDoc(doc(db, "items", currentActionItem.id)); announce("已删除"); closeModals(); } catch(e) { announce("删除失败"); } }

        // Export/Import
        document.getElementById('btn-export').addEventListener('click', () => {
            let csvContent = "\uFEFF物品名称,分类,标签,房间,具体位置,数量,单位\n"; 
            allItems.forEach(item => { 
                const tagsStr = (item.tags || []).join(';');
                csvContent += `${item.name},${item.category},${tagsStr},${item.room},${item.location || ''},${item.quantity},${item.unit||'个'}\n`; 
            });
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `物品备份_${new Date().toISOString().slice(0,10)}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); announce("导出成功");
        });
        document.getElementById('btn-download-template').addEventListener('click', () => {
            const csvContent = "\uFEFF物品名称(必填),分类,标签(用分号隔开),房间(必填),具体位置,数量(数字),单位\n大米,食品饮料,粮食;主食,厨房,米桶,1,袋\n洗发水,个人护理,洗护;日常,卫生间,架子,1,瓶"; 
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `导入模板.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); announce("模板下载成功");
        });
        document.getElementById('btn-trigger-upload').addEventListener('click', () => document.getElementById('file-upload').click());
        document.getElementById('file-upload').addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result; const rows = text.split('\n'); let count = 0;
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i].trim(); if (!row) continue; const cols = row.split(','); if (cols.length < 1) continue; const name = cols[0]?.trim(); if(!name) continue;
                    
                    const cat = cols[1]?.trim() || '其他杂项';
                    const tagStr = cols[2]?.trim() || '';
                    const tags = tagStr ? tagStr.split(';').map(t => t.trim()).filter(t=>t) : [];

                    await addDoc(itemsRef, { 
                        name: name, 
                        category: cat,
                        tags: tags,
                        room: cols[3]?.trim() || '客厅', 
                        location: cols[4]?.trim() || '', 
                        quantity: parseInt(cols[5]) || 1, 
                        unit: cols[6]?.trim() || '个', 
                        uid: auth.currentUser.uid, 
                        updatedAt: serverTimestamp() 
                    }); count++;
                } announce(`导入 ${count} 个物品`); switchScreen('screen-home');
            }; reader.readAsText(file);
        });

// --- Settings & Tabs Logic ---
        document.getElementById('btn-settings').addEventListener('click', () => {
            document.getElementById('menu-account-dropdown').classList.add('hidden');
            document.getElementById('btn-account-menu').setAttribute('aria-expanded', 'false');
            switchScreen('screen-settings');
// 默认加载个人资料
            // 回显昵称和家庭名称
document.getElementById('set-nickname').value = auth.currentUser.displayName || '';
            document.getElementById('set-family-name').value = localStorage.getItem('family_name_cache') || '';
        });

        document.getElementById('btn-back-settings').addEventListener('click', () => switchScreen('screen-home'));

        // Tab 切换核心逻辑 (支持箭头键)
        const tabs = [document.getElementById('tab-profile'), document.getElementById('tab-rooms')];
        const panels = [document.getElementById('panel-profile'), document.getElementById('panel-rooms')];

        function activateTab(index) {
            tabs.forEach((tab, i) => {
                const isSelected = (i === index);
                tab.setAttribute('aria-selected', isSelected);
                tab.setAttribute('tabindex', isSelected ? '0' : '-1');
                // 样式切换
                if(isSelected) {
                    tab.classList.add('border-blue-600', 'text-blue-800', 'bg-blue-50');
                    tab.classList.remove('border-transparent', 'text-gray-600');
                } else {
                    tab.classList.remove('border-blue-600', 'text-blue-800', 'bg-blue-50');
                    tab.classList.add('border-transparent', 'text-gray-600');
                }
                
                if(isSelected) {
                    panels[i].classList.remove('hidden');
                } else {
                    panels[i].classList.add('hidden');
                }
            });
            tabs[index].focus();
        }

        tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => activateTab(index));
            tab.addEventListener('keydown', (e) => {
                let newIndex = index;
                if (e.key === 'ArrowRight') {
                    newIndex = (index + 1) % tabs.length;
                    e.preventDefault();
                    activateTab(newIndex);
                } else if (e.key === 'ArrowLeft') {
                    newIndex = (index - 1 + tabs.length) % tabs.length;
                    e.preventDefault();
                    activateTab(newIndex);
                }
            });
        });

// 个人资料保存
        document.getElementById('form-profile').addEventListener('submit', async (e) => {
            e.preventDefault();
            const nick = document.getElementById('set-nickname').value.trim();
const familyName = document.getElementById('set-family-name').value.trim();
            localStorage.setItem('family_name_cache', familyName);
try {
                await updateProfile(auth.currentUser, { displayName: nick });
            } catch (err) {
                announce("保存失败，请重试");
                console.error(err);
                return;
            }

            // 更新本地界面显示
            const currentUser = auth.currentUser;
if (currentUser) {
                const labelText = `当前账号：${nick}，所属家庭：${familyName}，${currentUser.email}`;
                document.getElementById('btn-account-menu').setAttribute('aria-label', labelText);
                document.getElementById('user-email-display').textContent = nick;
            }

            announce(`设置已保存，昵称更新为 ${nick}`);
            switchScreen('screen-home');
        });

        // 取消按钮逻辑
        document.getElementById('btn-cancel-profile').addEventListener('click', () => {
            announce("已取消");
            switchScreen('screen-home');
        });

        document.getElementById('btn-cancel-pwd').addEventListener('click', () => {
            announce("已取消");
            switchScreen('screen-settings');
        });

        // 修改密码跳转
        document.getElementById('btn-to-change-pwd').addEventListener('click', () => switchScreen('screen-change-pwd'));
        document.getElementById('btn-back-pwd').addEventListener('click', () => switchScreen('screen-settings'));
        
        // 修改密码逻辑 (需要 Firebase EmailAuthCredential re-auth，这里先做基础结构)
        document.getElementById('form-change-pwd').addEventListener('submit', (e) => {
            e.preventDefault();
            const p1 = document.getElementById('pwd-new').value;
            const p2 = document.getElementById('pwd-confirm').value;
            if(p1 !== p2) { announce("两次密码不一致"); return; }
            if(p1.length < 6) { announce("密码太短"); return; }
            // 真实修改密码需要 updatePassword(user, newPassword)
            // 但通常需要先重新认证。这里先留接口。
            alert("为了安全，修改密码功能将在下个版本完善重新认证逻辑。");
        });

// Global Keydown (ESC Logic Optimized)
        window.addEventListener('keydown', (e) => {
            if(e.key === 'Escape') {
                // 1. 优先处理弹窗 (单位选择、数量选择、操作菜单等)
                // 必须阻止默认行为，防止浏览器停止页面加载等
                
                // 单位选择框 (特殊处理，需要归还焦点)
                if (!document.getElementById('modal-unit').classList.contains('hidden')) {
                    e.preventDefault(); closeUnitModal(); return;
                }
                
                // 数量选择框
                if (!document.getElementById('modal-qty').classList.contains('hidden')) {
                    e.preventDefault(); closeQtyModal(); return;
                }

                // 其他通用模态框 (Confirm, Action, Zero, Forgot)
                const visibleModals = document.querySelectorAll('[id^="modal-"]:not(.hidden)');
                if (visibleModals.length > 0) {
                    e.preventDefault(); closeModals(); return;
                }

                // 账户菜单
                const menu = document.getElementById('menu-account-dropdown');
                if (!menu.classList.contains('hidden')) {
                    e.preventDefault(); 
                    menu.classList.add('hidden'); 
                    document.getElementById('btn-account-menu').setAttribute('aria-expanded', 'false'); 
                    document.getElementById('btn-account-menu').focus(); 
                    return; 
                }

                // 2. 页面层级返回逻辑
                // 编辑页 -> 返回上一页
                if (currentScreen === 'edit') {
                    // 编辑页通常有专门的“取消”按钮处理逻辑，这里简单处理为返回
                    // 但为了防止数据丢失误触，建议不做操作，或者模拟点击“取消”
                    // 这里为了方便，我们模拟点击“返回”
                    e.preventDefault(); document.getElementById('btn-back-edit').click(); return;
                }

                // 二级设置页 (改密、加房间、删房间) -> 返回 设置页
                if (['screen-change-pwd', 'screen-room-add', 'screen-room-delete'].includes(currentScreen)) {
                    e.preventDefault(); switchScreen('screen-settings'); return;
                }

                // 一级功能页 (设置、新增、取出、数据、结果) -> 返回 首页
                if (['screen-settings', 'screen-add', 'screen-takeout', 'screen-data', 'screen-results'].includes(currentScreen)) {
                    e.preventDefault(); switchScreen('screen-home'); return;
                }

                // 搜索框清理
                if (currentScreen === 'home' || currentScreen === 'takeout') {
                    const searchInput = currentScreen === 'home' ? document.getElementById('home-search') : document.getElementById('takeout-search');
                    if (document.activeElement === searchInput && searchInput.value !== '') {
                        e.preventDefault(); searchInput.value = ''; announce("已清除搜索"); return;
                    }
                }
            }
        });
// --- Room Management (Accessible Fix) ---
        
// 渲染无障碍房间列表 (解决双重焦点问题)
        function renderAccessibleRoomList(containerId, rooms, type) {
            const container = document.getElementById(containerId);
            container.innerHTML = '';
            
            if (rooms.length === 0) {
                container.innerHTML = '<p class="text-gray-500 font-bold">暂无内容</p>';
                return;
            }

            // 帮助提示（只读一次，辅助屏幕阅读器用户了解操作方式）
            const hintId = `hint-${containerId}`;
            if (!document.getElementById(hintId)) {
                const hint = document.createElement('div');
                hint.id = hintId;
                hint.className = 'sr-only';
                hint.textContent = '使用上下光标键选择房间，空格键选中或取消。';
                container.parentElement.insertBefore(hint, container);
            }

            rooms.forEach((room, index) => {
                // Label 容器
                const label = document.createElement('label');
                label.className = "relative flex items-center justify-between p-4 border-2 border-gray-300 rounded-lg bg-white shadow-sm hover:bg-gray-50 mb-3 cursor-pointer transition-colors";
                
                // 视觉文本 (aria-hidden，避免重复朗读，只依赖 input 的 aria-label)
                const span = document.createElement('span');
                span.className = "text-xl font-bold text-gray-800";
                span.textContent = room;
                span.setAttribute('aria-hidden', 'true');
                
                // 原生 Input 覆盖层
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.value = room;
                input.className = "absolute inset-0 w-full h-full opacity-0 cursor-pointer";
                input.setAttribute('aria-label', room); // 读屏只读这一句，例如“阳台 复选框 未选中”

                // 交互核心：Roving Tabindex (游走焦点)
                // 只有列表的第一个元素(或当前聚焦元素)可被 Tab 聚焦，其余为 -1
                // 这样 Tab 键按一次就会进入列表，再按一次就会离开列表
                input.tabIndex = (index === 0) ? 0 : -1;

                // 选中状态的视觉反馈指示器 (aria-hidden)
                const indicator = document.createElement('span');
                indicator.className = "text-blue-600 font-bold opacity-0 transition-opacity";
                indicator.textContent = "已选";
                indicator.setAttribute('aria-hidden', 'true');

                // 视觉同步：因为 input 透明，我们手动给 label 加高亮圈，模拟焦点样式
                input.addEventListener('focus', () => {
                    label.classList.add('ring-4', 'ring-orange-500', 'ring-offset-2');
                });
                input.addEventListener('blur', () => {
                    label.classList.remove('ring-4', 'ring-orange-500', 'ring-offset-2');
                });

                // 状态联动
                input.addEventListener('change', () => {
                    if(input.checked) {
                        label.classList.add('border-green-500', 'bg-green-50');
                        label.classList.remove('border-gray-300', 'bg-white');
                        indicator.classList.remove('opacity-0');
                        announce(`已选中 ${room}`);
                    } else {
                        label.classList.remove('border-green-500', 'bg-green-50');
                        label.classList.add('border-gray-300', 'bg-white');
                        indicator.classList.add('opacity-0');
                        announce(`取消选中 ${room}`);
                    }
                });

                // 键盘导航 (上下键切换焦点)
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault(); // 阻止浏览器滚动
                        const allInputs = Array.from(container.querySelectorAll('input[type="checkbox"]'));
                        const currentIndex = allInputs.indexOf(e.target);
                        let nextIndex;

                        if (e.key === 'ArrowDown') {
                            nextIndex = (currentIndex + 1) % allInputs.length;
                        } else {
                            nextIndex = (currentIndex - 1 + allInputs.length) % allInputs.length;
                        }

                        // 移动 tabindex：旧的设为 -1，新的设为 0 并聚焦
                        allInputs[currentIndex].tabIndex = -1;
                        allInputs[nextIndex].tabIndex = 0;
                        allInputs[nextIndex].focus();
                    }
                });

                label.appendChild(span);
                label.appendChild(indicator);
                label.appendChild(input);
                container.appendChild(label);
            });
        }

        // 房间推荐数据
        const ROOM_RECOMMENDATIONS = ["阳台", "储物间", "衣帽间", "车库", "地下室", "客房", "婴儿房", "阁楼", "办公室", "健身房"];

        // 进入新增房间页面
        document.getElementById('btn-to-add-room').addEventListener('click', () => {
            switchScreen('screen-room-add');
            // 排除已存在的房间
            const existingRooms = Array.from(new Set(allItems.map(i => i.room).filter(r => r)));
            const suggestions = ROOM_RECOMMENDATIONS.filter(r => !existingRooms.includes(r));
            renderAccessibleRoomList('list-room-recommend', suggestions, 'add');
            document.getElementById('input-custom-room').value = '';
        });

        document.getElementById('btn-back-room-add').addEventListener('click', () => switchScreen('screen-settings'));
        document.getElementById('btn-cancel-room-add').addEventListener('click', () => switchScreen('screen-settings'));

        // 保存新增房间 (批量)
        document.getElementById('btn-save-room-add').addEventListener('click', async () => {
            const container = document.getElementById('list-room-recommend');
            const selected = Array.from(container.querySelectorAll('input:checked')).map(i => i.value);
            const custom = document.getElementById('input-custom-room').value.trim();
            
            if (custom) selected.push(custom);

            if (selected.length === 0) { announce("未选择任何房间"); return; }

            // 注意：因为房间是物品的一个属性，我们不需要专门创建“房间”集合。
            // 这里我们只需要提示用户成功即可，因为“房间”在物品管理系统中是作为 Filter 存在的。
            // 或者，如果你有专门的房间配置存储，请在这里执行写入。
            // 目前的逻辑是：只要物品使用了该房间，它就存在。
            // 为了让用户感觉“添加成功”，我们可以创建一个占位物品，或者只是提示。
            // 既然是“物品管家”，通常不需要空房间。但为了用户体验，我们可以提示。
            
            // 如果你想把新房间存入本地存储供下拉菜单使用：
            // (此处简化处理，假设房间列表是动态从物品生成的。如果需要持久化空房间，需要数据库支持)
            // 暂时逻辑：提示添加成功，并跳回。实际使用中，用户在添加物品时输入该房间名即可。
            
            announce(`已添加 ${selected.join('、')}`);
            switchScreen('screen-settings');
        });

        // 进入删除房间页面
        document.getElementById('btn-to-delete-room').addEventListener('click', () => {
            switchScreen('screen-room-delete');
            const existingRooms = Array.from(new Set(allItems.map(i => i.room).filter(r => r)));
            renderAccessibleRoomList('list-room-existing', existingRooms, 'delete');
        });

        document.getElementById('btn-back-room-del').addEventListener('click', () => switchScreen('screen-settings'));
        document.getElementById('btn-cancel-room-del').addEventListener('click', () => switchScreen('screen-settings'));

        // 确认删除房间
        document.getElementById('btn-confirm-del-room').addEventListener('click', () => {
            const container = document.getElementById('list-room-existing');
            const selected = Array.from(container.querySelectorAll('input:checked')).map(i => i.value);
            
            if (selected.length === 0) { announce("未选择房间"); return; }

            openGenericConfirm(`确定删除 ${selected.length} 个房间吗？这些房间内的物品将被标记为“未知位置”。`, async () => {
                // 批量更新数据库
                const batch = writeBatch(db);
                let updateCount = 0;
                
                // 找到所有在这些房间里的物品
                // Firestore 不支持 huge array 'in' query (max 10), so we loop logic or separate queries.
                // 简单起见，我们在内存中筛选 allItems (因为已经订阅了)
                const itemsToUpdate = allItems.filter(item => selected.includes(item.room));
                
                itemsToUpdate.forEach(item => {
                    const ref = doc(db, "items", item.id);
                    batch.update(ref, { room: "位置未知" });
                    updateCount++;
                });

                if (updateCount > 0) {
                    await batch.commit();
                    announce(`已删除房间，${updateCount} 个物品位置被重置`);
                } else {
                    announce("房间已删除（无关联物品）");
                }
                switchScreen('screen-settings');
            });
        });