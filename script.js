(function () {
    'use strict';

    const initInterval = setInterval(() => {
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#ui-preset-update-button');
        const saveAsButton = document.querySelector('#ui-preset-save-button');

        if (originalSelect && updateButton && saveAsButton && window.SillyTavern?.getContext && !document.querySelector('#theme-manager-panel')) {
            console.log("Theme Manager (v23.0 Final Stable): 初始化...");
            clearInterval(initInterval);

            try {
                const { getRequestHeaders, showLoader, hideLoader, callGenericPopup } = SillyTavern.getContext();
                // --- 样式注入 ---
                const tmStyle = document.createElement('style');
                tmStyle.textContent = `
                    #theme-manager-panel .menu_button i { margin-right: 4px; }
                    /* 调整按钮尺寸和间距：字体更小，内边距更窄 */
                    #theme-manager-panel .theme-item-buttons button { 
                        background: transparent; 
                        border: none; 
                        cursor: pointer; 
                        color: var(--main-text-color); 
                        opacity: 0.6; 
                        transition: opacity 0.2s; 
                        padding: 0 2px; /* 间距缩小 */
                        font-size: 0.85em; /* 尺寸缩小 */
                        line-height: 1;
                    }
                    #theme-manager-panel .theme-item-buttons button:hover { opacity: 1; transform: scale(1.1); }
                    #theme-manager-panel .theme-item-buttons .delete-btn:hover { color: #ff6b6b; }
                    
                    /* 收藏星星的颜色区分 */
                    #theme-manager-panel .favorite-btn .fa-solid.fa-star { color: #ffd700; opacity: 1; } /* 实心金星 */
                    #theme-manager-panel .favorite-btn .fa-regular.fa-star { color: var(--main-text-color); opacity: 0.4; } /* 空心暗星 */

                    #theme-manager-panel .theme-category-title .folder-buttons button,
                    #theme-manager-panel .theme-category-title .folder-reorder-buttons button { background: transparent; border: none; cursor: pointer; color: var(--main-text-color); opacity: 0.6; font-size: 0.9em; padding: 0 2px; }
                    #theme-manager-panel .theme-category-title button:hover { opacity: 1; }
                    .theme-manager-icon-btn { display: inline-flex; align-items: center; justify-content: center; }
                `;
                document.head.appendChild(tmStyle);
                // --- 样式注入结束 ---
                const FAVORITES_KEY = 'themeManager_favorites';
                const COLLAPSE_KEY = 'themeManager_collapsed';
                const CATEGORY_ORDER_KEY = 'themeManager_categoryOrder';
                const COLLAPSED_FOLDERS_KEY = 'themeManager_collapsedFolders';
                const THEME_BACKGROUND_BINDINGS_KEY = 'themeManager_backgroundBindings';
                const CHARACTER_THEME_BINDINGS_KEY = 'themeManager_characterThemeBindings';

                let allParsedThemes = [];
                let refreshNeeded = false;
                let isReorderMode = false;
                let isManageBgMode = false;
                let isBindingMode = false;
                let themeNameToBind = null;
                let selectedBackgrounds = new Set();

                async function apiRequest(endpoint, method = 'POST', body = {}) {
                    try {
                        const headers = getRequestHeaders();
                        const options = { method, headers, body: JSON.stringify(body) };
                        const response = await fetch(`/api/${endpoint}`, options);
                        const responseText = await response.text();
                        if (!response.ok) {
                            throw new Error(responseText || `HTTP error! status: ${response.status}`);
                        }
                        if (responseText.trim().toUpperCase() === 'OK') return { status: 'OK' };
                        return responseText ? JSON.parse(responseText) : {};
                    } catch (error) {
                        console.error(`API request to /api/${endpoint} failed:`, error);
                        toastr.error(`API请求失败: ${error.message}`);
                        throw error;
                    }
                }

                async function getAllThemesFromAPI() { return (await apiRequest('settings/get', 'POST', {})).themes || []; }
                async function deleteTheme(themeName) { await apiRequest('themes/delete', 'POST', { name: themeName }); }
                async function saveTheme(themeObject) { await apiRequest('themes/save', 'POST', themeObject); }

                async function deleteBackground(bgFile) {
                    const body = { bg: bgFile };
                    const headers = getRequestHeaders();
                    try {
                        const response = await fetch('/api/backgrounds/delete', {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify(body)
                        });
                        if (!response.ok) {
                            const responseText = await response.text();
                            throw new Error(responseText || `HTTP error! status: ${response.status}`);
                        }
                    } catch (error) {
                        console.error(`删除背景 "${bgFile}" 时出错:`, error);
                        throw error;
                    }
                }

                async function uploadBackground(formData) {
                    const headers = getRequestHeaders();
                    delete headers['Content-Type'];
                    const response = await fetch('/api/backgrounds/upload', { method: 'POST', headers, body: formData });
                    if (!response.ok) {
                        const responseText = await response.text();
                        throw new Error(responseText || `HTTP error! status: ${response.status}`);
                    }
                }

                function manualUpdateOriginalSelect(action, oldName, newName) {
                    const originalSelect = document.querySelector('#themes');
                    if (!originalSelect) return;
                    if (action === 'add') {
                        const option = document.createElement('option');
                        option.value = newName; option.textContent = newName;
                        originalSelect.appendChild(option);
                    } else if (action === 'delete') {
                        const optionToDelete = originalSelect.querySelector(`option[value="${oldName}"]`);
                        if (optionToDelete) optionToDelete.remove();
                    } else if (action === 'rename') {
                        const optionToRename = originalSelect.querySelector(`option[value="${oldName}"]`);
                        if (optionToRename) { optionToRename.value = newName; optionToRename.textContent = newName; }
                    }
                }
                
                function getTagsFromThemeName(themeName) {
                    const tags = [];
                    const tagRegex = /\[(.*?)\]/g;
                    let match;
                    while ((match = tagRegex.exec(themeName)) !== null) {
                        if (match[1].trim()) tags.push(match[1].trim());
                    }
                    if (tags.length === 0) tags.push('未分类');
                    return tags;
                }

                const originalContainer = originalSelect.parentElement;
                if (!originalContainer) return;
                originalSelect.style.display = 'none';

                const managerPanel = document.createElement('div');
                managerPanel.id = 'theme-manager-panel';
                managerPanel.innerHTML = `
                    <div id="theme-manager-header">
                        <h4><i class="fas fa-palette"></i> 主题美化管理</h4>
                        <div id="native-buttons-container"></div>
                        <div id="theme-manager-toggle-icon" class="fa-solid fa-chevron-down"></div>
                    </div>
                    <div id="theme-manager-content">
                        <div id="theme-manager-refresh-notice" style="display:none; margin: 10px 0; padding: 10px; background-color: rgba(255, 193, 7, 0.15); border: 1px solid #ffc107; border-radius: 5px; text-align: center; color: var(--main-text-color);">
                            <i class="fas fa-lightbulb"></i> <b>提示：</b>检测到文件变更（主题或背景图）。为确保所有更改完全生效，请在完成所有操作后
                            <a id="theme-manager-refresh-page-btn" style="color:var(--primary-color, #007bff); text-decoration:underline; cursor:pointer; font-weight:bold;">刷新页面</a>。
                        </div>
                        <div class="theme-manager-actions" data-mode="theme">
                            <div class="tm-button-row">
                                <input type="search" id="theme-search-box" placeholder="搜索主题..." class="text_pole">
                                <button id="random-theme-btn" class="menu_button" title="随机应用一个主题"><i class="fas fa-dice"></i> 随机</button>
                            </div>
                            <div class="tm-button-row">
                                <button id="batch-edit-btn" class="menu_button" title="进入/退出批量编辑模式"><i class="fas fa-wrench"></i> 批量编辑</button>
                                <button id="batch-import-btn" class="menu_button" title="从文件批量导入主题"><i class="fas fa-file-import"></i> 批量导入</button>
                                <button id="manage-bgs-btn" class="menu_button" title="管理背景图"><i class="fas fa-image"></i> 管理背景</button>
                            </div>
                        </div>
                        <div class="theme-manager-actions" data-mode="shared">
                            <div class="tm-button-row">
                                <button id="reorder-mode-btn" class="menu_button" title="调整文件夹顺序"><i class="fas fa-sort"></i> 调整顺序</button>
                                <button id="expand-all-btn" class="menu_button" title="展开所有文件夹"><i class="fas fa-angle-double-down"></i> 全部展开</button>
                                <button id="collapse-all-btn" class="menu_button" title="折叠所有文件夹"><i class="fas fa-angle-double-up"></i> 全部折叠</button>
                            </div>
                            <div class="tm-button-row">
                                <button id="tm-export-settings-btn" class="menu_button" title="导出一个包含所有插件设置的配置文件，用于在不同设备间同步。"><i class="fas fa-file-export"></i> 导出配置</button>
                                <button id="tm-import-settings-btn" class="menu_button" title="从配置文件中导入插件设置。"><i class="fas fa-file-arrow-up"></i> 导入配置</button>
                            </div>
                        </div>
                        <div id="background-actions-bar" style="display:none;" data-mode="bg">
                            <button id="batch-import-bg-btn" class="menu_button menu_button_icon"><i class="fas fa-plus"></i> 批量导入背景</button>
                            <button id="batch-delete-bg-btn"  class="menu_button menu_button_icon" disabled><i class="fas fa-trash"></i> 删除选中背景</button>
                        </div>
                        <div id="batch-actions-bar" style="display:none;" data-mode="theme">
                            <button id="batch-add-tag-btn" class="menu_button"><i class="fas fa-plus"></i> 添加标签</button>
                            <button id="batch-move-tag-btn" class="menu_button"><i class="fas fa-arrow-right"></i> 移动到分类</button>
                            <button id="batch-delete-tag-btn" class="menu_button"><i class="fas fa-times"></i> 移除标签</button>
                            <button id="batch-dissolve-btn" class="menu_button"><i class="fas fa-folder-minus"></i> 解散文件夹</button> 
                            <button id="batch-delete-btn" class="menu_button"><i class="fas fa-trash"></i> 删除选中</button>
                        </div>
                        <div class="theme-content"></div>
                    </div>`;
                originalContainer.prepend(managerPanel);
                
                const nativeButtonsContainer = managerPanel.querySelector('#native-buttons-container');
                nativeButtonsContainer.appendChild(updateButton);
                nativeButtonsContainer.appendChild(saveAsButton);
                
                const header = managerPanel.querySelector('#theme-manager-header');
                const content = managerPanel.querySelector('#theme-manager-content');
                const toggleIcon = managerPanel.querySelector('#theme-manager-toggle-icon');
                const batchEditBtn = managerPanel.querySelector('#batch-edit-btn');
                const batchActionsBar = managerPanel.querySelector('#batch-actions-bar');
                const contentWrapper = managerPanel.querySelector('.theme-content');
                const searchBox = managerPanel.querySelector('#theme-search-box');
                const randomBtn = managerPanel.querySelector('#random-theme-btn');
                const batchImportBtn = managerPanel.querySelector('#batch-import-btn');
                const reorderModeBtn = managerPanel.querySelector('#reorder-mode-btn');
                const expandAllBtn = managerPanel.querySelector('#expand-all-btn');
                const collapseAllBtn = managerPanel.querySelector('#collapse-all-btn');
                const manageBgsBtn = managerPanel.querySelector('#manage-bgs-btn');
                const backgroundActionsBar = managerPanel.querySelector('#background-actions-bar');
                const batchImportBgBtn = managerPanel.querySelector('#batch-import-bg-btn');
                const batchDeleteBgBtn = managerPanel.querySelector('#batch-delete-bg-btn');
                
                const refreshNotice = managerPanel.querySelector('#theme-manager-refresh-notice');
                const refreshBtn = managerPanel.querySelector('#theme-manager-refresh-page-btn');
                refreshBtn.addEventListener('click', () => location.reload());

                function showRefreshNotification() {
                    if (!refreshNeeded) {
                        refreshNeeded = true;
                        refreshNotice.style.display = 'block';
                    }
                }

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = '.json';
                fileInput.style.display = 'none';
                document.body.appendChild(fileInput);

                const bgFileInput = document.createElement('input');
                bgFileInput.type = 'file';
                bgFileInput.multiple = true;
                bgFileInput.accept = 'image/*,video/*';
                bgFileInput.style.display = 'none';
                document.body.appendChild(bgFileInput);

                // VVVVVVVVVVVV 新增代码 VVVVVVVVVVVV -->
                const settingsFileInput = document.createElement('input');
                settingsFileInput.type = 'file';
                settingsFileInput.accept = '.json';
                settingsFileInput.style.display = 'none';
                document.body.appendChild(settingsFileInput);
                // ^^^^^^^^^^^^ 新增代码 ^^^^^^^^^^^^ -->

                let favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
                let allThemeObjects = [];
                let isBatchEditMode = false;
                let selectedForBatch = new Set();
                let selectedFoldersForBatch = new Set();
                let themeBackgroundBindings = JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {};

                function saveCategoryOrder() {
                    const newOrder = Array.from(contentWrapper.querySelectorAll('.theme-category'))
                        .map(div => div.dataset.categoryName)
                        .filter(name => name && name !== '⭐ 收藏夹' && name !== '未分类');
                    localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(newOrder));
                    toastr.info('文件夹顺序已保存。');
                }

                function setCollapsed(isCollapsed, animate = false) {
                    if (isCollapsed) {
                        if (animate) {
                            content.style.maxHeight = content.scrollHeight + 'px';
                            requestAnimationFrame(() => {
                                content.style.maxHeight = '0px';
                                content.style.paddingTop = '0px';
                                content.style.paddingBottom = '0px';
                                content.style.fontSize = '0';
                            });
                        } else {
                            content.style.maxHeight = '0px';
                            content.style.paddingTop = '0px';
                            content.style.paddingBottom = '0px';
                            content.style.fontSize = '0';
                        }
                        toggleIcon.classList.add('collapsed');
                        localStorage.setItem(COLLAPSE_KEY, 'true');
                    } else {
                        content.style.paddingTop = '';
                        content.style.paddingBottom = '';
                        content.style.fontSize = '';
                        if (animate) {
                            content.style.maxHeight = content.scrollHeight + 'px';
                            setTimeout(() => { content.style.maxHeight = ''; }, 300);
                        } else {
                            content.style.maxHeight = '';
                        }
                        toggleIcon.classList.remove('collapsed');
                        localStorage.setItem(COLLAPSE_KEY, 'false');
                    }
                }

                async function renderBackgroundManagerUI() {
                    const scrollTop = contentWrapper.scrollTop;
                    contentWrapper.innerHTML = '正在加载背景图...';
                
                    const bgListContainer = document.createElement('div');
                    bgListContainer.className = 'bg_list';
                
                    const systemBgs = document.querySelectorAll('#bg_menu_content .bg_example');
                    const customBgs = document.querySelectorAll('#bg_custom_content .bg_example');
                
                    const allBgs = [...systemBgs, ...customBgs];
                
                    if (allBgs.length === 1 && allBgs[0].querySelector('.add_bg_but')) {
                        contentWrapper.innerHTML = '没有找到背景图。';
                        return;
                    }
                
                    allBgs.forEach(bg => {
                        if (bg.querySelector('.add_bg_but')) return;

                        const bgFile = bg.getAttribute('bgfile');
                        if (!bgFile) return;
                
                        const clone = bg.cloneNode(true);
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'bg-select-checkbox';
                        checkbox.dataset.bgfile = bgFile;
                        checkbox.checked = selectedBackgrounds.has(bgFile);
                        
                        checkbox.addEventListener('change', () => {
                            if (checkbox.checked) {
                                selectedBackgrounds.add(bgFile);
                                clone.classList.add('selected-for-batch');
                            } else {
                                selectedBackgrounds.delete(bgFile);
                                clone.classList.remove('selected-for-batch');
                            }
                            batchDeleteBgBtn.disabled = selectedBackgrounds.size === 0;
                        });
                
                        clone.prepend(checkbox);
                        clone.addEventListener('click', (e) => {
                            if (e.target !== checkbox) {
                                checkbox.click();
                            }
                        });
                        if (selectedBackgrounds.has(bgFile)) {
                            clone.classList.add('selected-for-batch');
                        }
                        bgListContainer.appendChild(clone);
                    });
                
                    contentWrapper.innerHTML = '';
                    if (bgListContainer.children.length === 0) {
                        contentWrapper.innerHTML = '<div style="padding: 20px; text-align: center;"><i class="fas fa-image" style="font-size: 2em; opacity: 0.5;"></i><p>没有找到背景图。</p></div>';
                    } else {
                        contentWrapper.appendChild(bgListContainer);
                    }
                    contentWrapper.scrollTop = scrollTop;
                    batchDeleteBgBtn.disabled = selectedBackgrounds.size === 0;
                }

                async function buildThemeUI() {
                    const scrollTop = contentWrapper.scrollTop;
                    contentWrapper.innerHTML = '正在加载主题...';
                    try {
                        allThemeObjects = await getAllThemesFromAPI();
                        contentWrapper.innerHTML = '';

                        allParsedThemes = Array.from(originalSelect.options).map(option => {
                            const themeName = option.value;
                            if (!themeName) return null;
                            const tags = getTagsFromThemeName(themeName);
                            const displayName = themeName.replace(/\[.*?\]/g, '').trim() || themeName;
                            return { value: themeName, display: displayName, tags: tags };
                        }).filter(Boolean);

                        const allCategories = new Set(allParsedThemes.flatMap(t => t.tags));
                        
                        let savedOrder = JSON.parse(localStorage.getItem(CATEGORY_ORDER_KEY)) || [];
                        const savedOrderSet = new Set(savedOrder);
                        const newCategories = Array.from(allCategories).filter(cat => !savedOrderSet.has(cat) && cat !== '未分类' && cat !== '⭐ 收藏夹');
                        
                        const currentOrder = [...savedOrder.filter(cat => allCategories.has(cat)), ...newCategories.sort((a, b) => a.localeCompare(b, 'zh-CN'))];
                        localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(currentOrder));
                        
                        const categoryOrderMap = new Map(currentOrder.map((cat, index) => [cat, index]));
                        
                        const specialCategories = ['⭐ 收藏夹', '未分类'];
                        const sortedNormalCategories = Array.from(allCategories)
                            .filter(cat => !specialCategories.includes(cat))
                            .sort((a, b) => (categoryOrderMap.get(a) ?? Infinity) - (categoryOrderMap.get(b) ?? Infinity));
                        
                        const sortedCategories = ['⭐ 收藏夹', ...sortedNormalCategories];
                        if (allCategories.has('未分类')) {
                            sortedCategories.push('未分类');
                        }

                        const collapsedFolders = new Set(JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY)) || []);

                        sortedCategories.forEach(category => {
                            const themesInCategory = (category === '⭐ 收藏夹') ? allParsedThemes.filter(t => favorites.includes(t.value)) : allParsedThemes.filter(t => t.tags.includes(category));
                            if (themesInCategory.length === 0 && category !== '未分类' && category !== '⭐ 收藏夹') return;

                            const categoryDiv = document.createElement('div');
                            categoryDiv.className = 'theme-category';
                            categoryDiv.dataset.categoryName = category;
                            const title = document.createElement('div');
                            title.className = 'theme-category-title';
                            
                            if (category !== '未分类' && category !== '⭐ 收藏夹') {
                                title.draggable = true;
                            }

                            let titleHTML = '';
                            if (category !== '未分类' && category !== '⭐ 收藏夹') {
                                titleHTML += `<input type="checkbox" class="folder-select-checkbox" title="选择文件夹进行批量操作">`;
                            }
                            
                            const displayCategory = category === '⭐ 收藏夹' ? '<i class="fas fa-star" style="color:#ffd700;"></i> 收藏夹' : category;
                            titleHTML += `<span>${displayCategory}</span>`;

                            if (category !== '未分类' && category !== '⭐ 收藏夹') {
                                titleHTML += `
                                    <div class="folder-buttons">
                                        <button class="rename-folder-btn" title="重命名文件夹"><i class="fas fa-pen"></i></button>
                                        <button class="dissolve-folder-btn" title="解散此文件夹"><i class="fas fa-folder-minus"></i></button>
                                    </div>
                                    <div class="folder-reorder-buttons">
                                        <button class="move-folder-up-btn" title="上移"><i class="fas fa-arrow-up"></i></button>
                                        <button class="move-folder-down-btn" title="下移"><i class="fas fa-arrow-down"></i></button>
                                    </div>
                                `;
                            }
                            title.innerHTML = titleHTML;

                            const list = document.createElement('ul');
                            list.className = 'theme-list';
                            list.style.display = collapsedFolders.has(category) ? 'none' : 'block';

                            themesInCategory.forEach(theme => {
                                const item = document.createElement('li');
                                item.className = 'theme-item';
                                item.dataset.value = theme.value;
                                const isFavorited = favorites.includes(theme.value);
                                // 关键修改：明确区分 fa-solid (实心) 和 fa-regular (空心)
                                const starIconClass = isFavorited ? 'fa-solid fa-star' : 'fa-regular fa-star';
                                const isBound = !!themeBackgroundBindings[theme.value];

                                item.innerHTML = `
                                    <span class="theme-item-name">${theme.display}</span>
                                    <div class="theme-item-buttons">
                                        <button class="link-bg-btn ${isBound ? 'linked' : ''}" title="关联背景图"><i class="fas fa-link"></i></button>
                                        <button class="unbind-bg-btn" style="display: ${isBound ? 'inline-block' : 'none'}" title="解绑背景"><i class="fas fa-unlink"></i></button>
                                        <button class="favorite-btn" title="收藏"><i class="${starIconClass}"></i></button>
                                        <button class="rename-btn" title="重命名"><i class="fas fa-pen"></i></button>
                                        <button class="delete-btn" title="删除"><i class="fas fa-trash"></i></button>
                                    </div>`;
                                list.appendChild(item);
                            });

                            categoryDiv.appendChild(title);
                            categoryDiv.appendChild(list);
                            contentWrapper.appendChild(categoryDiv);
                        });
                        
                        contentWrapper.scrollTop = scrollTop;
                        updateActiveState();

                    } catch (err) {
                        contentWrapper.innerHTML = '加载主题失败，请检查浏览器控制台获取更多信息。';
                    }
                }

                function updateActiveState() {
                    const currentValue = originalSelect.value;
                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        item.classList.toggle('active', item.dataset.value === currentValue);
                    });
                }
                
                async function performBatchRename(renameLogic) {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    showLoader();
                    
                    let successCount = 0;
                    let errorCount = 0;
                    let skippedCount = 0;
                    const currentThemes = await getAllThemesFromAPI();
                    let favoritesToUpdate = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];

                    for (const oldName of selectedForBatch) {
                        try {
                            const themeObject = currentThemes.find(t => t.name === oldName);
                            if (!themeObject) {
                                console.warn(`批量操作：在API返回中未找到主题 "${oldName}"，已跳过。`);
                                skippedCount++;
                                continue;
                            }
                            const newName = renameLogic(oldName);
                            if (currentThemes.some(t => t.name === newName && t.name !== oldName)) {
                                console.warn(`批量操作：目标名称 "${newName}" 已存在，已跳过 "${oldName}"。`);
                                toastr.warning(`主题 "${newName}" 已存在，跳过重命名。`);
                                skippedCount++;
                                continue;
                            }
                            if (newName !== oldName) {
                                const newThemeObject = { ...themeObject, name: newName };
                                await saveTheme(newThemeObject);
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, newName);

                                const favIndex = favoritesToUpdate.indexOf(oldName);
                                if (favIndex > -1) {
                                    favoritesToUpdate[favIndex] = newName;
                                }

                                if (themeBackgroundBindings[oldName]) {
                                    themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                    delete themeBackgroundBindings[oldName];
                                }
                            }
                            successCount++;
                        } catch (error) {
                            console.error(`批量重命名主题 "${oldName}" 时失败:`, error);
                            toastr.error(`处理主题 "${oldName}" 时失败: ${error.message}`);
                            errorCount++;
                        }
                    }
                    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoritesToUpdate));
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));

                    hideLoader();
                    selectedForBatch.clear();
                    
                    let summary = `批量操作完成！成功 ${successCount} 个`;
                    if (errorCount > 0) summary += `，失败 ${errorCount} 个`;
                    if (skippedCount > 0) summary += `，跳过 ${skippedCount} 个`;
                    summary += '。';
                    toastr.success(summary);

                    showRefreshNotification();
                    await buildThemeUI(); 
                }

                async function performBatchDelete() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    if (!confirm(`确定要删除选中的 ${selectedForBatch.size} 个主题吗？`)) return;

                    showLoader();
                    for (const themeName of selectedForBatch) {
                        const isCurrentlyActive = originalSelect.value === themeName;
                        await deleteTheme(themeName);
                        manualUpdateOriginalSelect('delete', themeName);
                        if (themeBackgroundBindings[themeName]) {
                            delete themeBackgroundBindings[themeName];
                        }
                        if (isCurrentlyActive) {
                            const azureOption = originalSelect.querySelector('option[value="Azure"]');
                            originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                            originalSelect.dispatchEvent(new Event('change'));
                        }
                    }
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));

                    selectedForBatch.clear();
                    hideLoader();
                    toastr.success('批量删除完成！');
                    
                    showRefreshNotification();
                    await buildThemeUI();
                }

                async function performBatchDissolve() {
                    if (selectedFoldersForBatch.size === 0) { toastr.info('请先选择至少一个文件夹。'); return; }
                    if (!confirm(`确定要解散选中的 ${selectedFoldersForBatch.size} 个文件夹吗？其中的所有主题将被移至“未分类”。`)) return;

                    showLoader();
                    let successCount = 0;
                    let errorCount = 0;
                    const themesToProcess = new Map();

                    selectedFoldersForBatch.forEach(folderName => {
                        allParsedThemes.forEach(theme => {
                            if (theme.tags.includes(folderName)) {
                                const newName = theme.value.replace(`[${folderName}]`, '').trim();
                                themesToProcess.set(theme.value, newName);
                            }
                        });
                    });

                    for (const [oldName, newName] of themesToProcess.entries()) {
                        try {
                            const themeObject = allThemeObjects.find(t => t.name === oldName);
                            if (themeObject) {
                                await saveTheme({ ...themeObject, name: newName });
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, newName);
                                if (themeBackgroundBindings[oldName]) {
                                    themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                    delete themeBackgroundBindings[oldName];
                                }
                                successCount++;
                            }
                        } catch(error) {
                            console.error(`解散文件夹时处理主题 "${oldName}" 失败:`, error);
                            errorCount++;
                        }
    
                    }
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                    
                    hideLoader();
                    selectedFoldersForBatch.clear();
                    toastr.success(`批量解散完成！成功处理 ${successCount} 个主题，失败 ${errorCount} 个。`);
                    
                    showRefreshNotification();
                    buildThemeUI();
                }


                // ===============================================
                // =========== 事件监听器 (EVENT LISTENERS) ===========
                // ===============================================

                // VVVVVVVVVVVV 新增代码 VVVVVVVVVVVV -->

                // ---------- 导入/导出插件配置 ----------

                const settingsKeysToSync = [
                    FAVORITES_KEY,
                    COLLAPSE_KEY,
                    CATEGORY_ORDER_KEY,
                    COLLAPSED_FOLDERS_KEY,
                    THEME_BACKGROUND_BINDINGS_KEY,
                    CHARACTER_THEME_BINDINGS_KEY,
                ];

                function exportSettings() {
                    const settingsToExport = {};
                    settingsKeysToSync.forEach(key => {
                        const value = localStorage.getItem(key);
                        if (value !== null) {
                            settingsToExport[key] = value;
                        }
                    });

                    const blob = new Blob([JSON.stringify(settingsToExport, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'theme_manager_config.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toastr.success('配置已成功导出！');
                }

                async function importSettings(event) {
                    const file = event.target.files[0];
                    if (!file) return;

                     // ### 最终优化的提示信息 ###
                    const userConfirmed = confirm(
                        '导入配置前请确认：\n\n' +
                        '此操作将覆盖您当前的插件设置，包括收藏夹、文件夹顺序和所有绑定关系。\n\n' +
                        '----------------------------------------------------------\n\n' +
                        '【重要】对于<本地部署>的用户：\n\n' +
                        '为确保所有绑定（角色卡、背景图等）都能正常工作，请在导入前，确保您已将源设备上的整个“default-user”文件夹，完整地复制并覆盖到本机对应目录下（若您并未更换设备，仅更换浏览器，可忽略这一步）。\n\n' +
                        '该文件夹路径为：SillyTavern/data/default-user。\n\n' +
                        '----------------------------------------------------------\n\n' +
                        '对于<云端部署>的用户，您可以直接导入。\n\n' +
                        '是否继续导入配置？'
                    );

                    if (!userConfirmed) {
                        event.target.value = ''; // 重置文件输入
                        return;
                    }

                    try {
                        const content = await file.text();
                        const settingsToImport = JSON.parse(content);

                        let importCount = 0;
                        for (const key in settingsToImport) {
                            if (settingsKeysToSync.includes(key)) {
                                localStorage.setItem(key, settingsToImport[key]);
                                importCount++;
                            }
                        }
                        
                        toastr.success(`成功导入 ${importCount} 条配置！请刷新页面以应用所有更改。`, '导入成功');
                        showRefreshNotification(); // 显示那个“请刷新页面”的横幅提示

                    } catch (error) {
                        console.error('导入配置失败:', error);
                        toastr.error(`导入失败，文件可能已损坏或格式不正确。错误: ${error.message}`);
                    } finally {
                        event.target.value = ''; // 确保总是重置文件输入
                    }
                }

                managerPanel.querySelector('#tm-export-settings-btn').addEventListener('click', exportSettings);
                managerPanel.querySelector('#tm-import-settings-btn').addEventListener('click', () => settingsFileInput.click());
                settingsFileInput.addEventListener('change', importSettings);
                
                // ---------- 功能结束 ----------

                // ^^^^^^^^^^^^ 新增代码 ^^^^^^^^^^^^ -->

                header.addEventListener('click', (e) => {
                    if (e.target.closest('#native-buttons-container')) return;
                    setCollapsed(content.style.maxHeight !== '0px', true);
                });

                searchBox.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    const categories = managerPanel.querySelectorAll('.theme-category');
                    
                    if (searchTerm) {
                        categories.forEach(category => {
                            const list = category.querySelector('.theme-list');
                            if (list) list.style.display = 'none';
                        });
                    }

                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        const isVisible = item.querySelector('.theme-item-name').textContent.toLowerCase().includes(searchTerm);
                        item.style.display = isVisible ? 'flex' : 'none';

                        if (isVisible && searchTerm) {
                            const parentCategory = item.closest('.theme-category');
                            if (parentCategory) {
                                const list = parentCategory.querySelector('.theme-list');
                                if (list) list.style.display = 'block';
                            }
                        }
                    });

                    if (!searchTerm) {
                        buildThemeUI();
                    }
                });

                randomBtn.addEventListener('click', async () => {
                    const themes = await getAllThemesFromAPI();
                    if (themes.length > 0) {
                        const randomIndex = Math.floor(Math.random() * themes.length);
                        originalSelect.value = themes[randomIndex].name;
                        originalSelect.dispatchEvent(new Event('change'));
                    }
                });
                
                reorderModeBtn.addEventListener('click', () => {
                    isReorderMode = !isReorderMode;
                    managerPanel.classList.toggle('reorder-mode', isReorderMode);
                    reorderModeBtn.classList.toggle('selected', isReorderMode);
                    reorderModeBtn.innerHTML = isReorderMode ? '<i class="fas fa-check"></i> 完成排序' : '<i class="fas fa-sort"></i> 调整顺序';
                    if (isReorderMode && isBatchEditMode) batchEditBtn.click();
                    if (isReorderMode && isManageBgMode) manageBgsBtn.click();
                });

                batchEditBtn.addEventListener('click', () => {
                    isBatchEditMode = !isBatchEditMode;
                    managerPanel.classList.toggle('batch-edit-mode', isBatchEditMode);
                    batchActionsBar.style.display = isBatchEditMode ? 'flex' : 'none';
                    batchEditBtn.classList.toggle('selected', isBatchEditMode);
                    batchEditBtn.innerHTML = isBatchEditMode ? '<i class="fas fa-times"></i> 退出编辑' : '<i class="fas fa-wrench"></i> 批量编辑';
                    
                    if (isBatchEditMode && isReorderMode) reorderModeBtn.click();
                    if (isBatchEditMode && isManageBgMode) manageBgsBtn.click();

                    if (!isBatchEditMode) {
                        selectedForBatch.clear();
                        selectedFoldersForBatch.clear();
                        managerPanel.querySelectorAll('.selected-for-batch').forEach(item => item.classList.remove('selected-for-batch'));
                        managerPanel.querySelectorAll('.theme-category-title.selected-for-batch').forEach(item => item.classList.remove('selected-for-batch'));
                        managerPanel.querySelectorAll('.folder-select-checkbox:checked').forEach(cb => cb.checked = false);
                    }
                });
                
                manageBgsBtn.addEventListener('click', () => {
                    isManageBgMode = !isManageBgMode;
                    managerPanel.classList.toggle('manage-bg-mode', isManageBgMode);
                    manageBgsBtn.classList.toggle('selected', isManageBgMode);
                    manageBgsBtn.innerHTML = isManageBgMode ? '<i class="fas fa-check"></i> 完成管理' : '<i class="fas fa-image"></i> 管理背景';

                    // --- START: 修改这里的逻辑 ---
                    // 获取所有在 [data-mode="theme"] 容器内的直接子元素（按钮和输入框）
                    const themeActionsContainer = managerPanel.querySelector('[data-mode="theme"]');
                    const elementsToToggle = themeActionsContainer.querySelectorAll('.tm-button-row > *');

                    elementsToToggle.forEach(element => {
                        // 当进入背景管理模式时，隐藏除了“管理背景”按钮之外的所有元素
                        if (element.id !== 'manage-bgs-btn') {
                            element.style.display = isManageBgMode ? 'none' : '';
                        }
                    });
                    // --- END: 修改结束 ---

                    backgroundActionsBar.style.display = isManageBgMode ? 'flex' : 'none';
    
                    // 隐藏/显示 'shared' 区域的按钮
                    const sharedActionsContainer = managerPanel.querySelector('[data-mode="shared"]');
                    if(sharedActionsContainer) {
                        sharedActionsContainer.style.display = isManageBgMode ? 'none' : 'flex';
                    }


                    if (isManageBgMode) {
                        if (isBatchEditMode) batchEditBtn.click();
                        if (isReorderMode) reorderModeBtn.click();
                        renderBackgroundManagerUI();
                    } else {
                        selectedBackgrounds.clear();
                        buildThemeUI();
                    }
                });

                expandAllBtn.addEventListener('click', () => {
                    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([]));
                    buildThemeUI();
                });
                
                collapseAllBtn.addEventListener('click', () => {
                    const allFolderNames = Array.from(contentWrapper.querySelectorAll('.theme-category'))
                        .map(div => div.dataset.categoryName)
                        .filter(name => name);
                    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(allFolderNames));
                    buildThemeUI();
                });

                fileInput.addEventListener('change', async (event) => {
                    const files = event.target.files;
                    if (!files.length) return;

                    showLoader();
                    let successCount = 0;
                    let errorCount = 0;

                    for (const file of files) {
                        try {
                            const fileContent = await file.text();
                            const themeObject = JSON.parse(fileContent);

                            if (themeObject && themeObject.name && typeof themeObject.main_text_color !== 'undefined') {
                                await saveTheme(themeObject);
                                successCount++;
                            } else {
                                console.warn(`文件 "${file.name}" 不是一个有效的主题文件，已跳过。`);
                                errorCount++;
                            }
                        } catch (err) {
                            console.error(`处理文件 "${file.name}" 时出错:`, err);
                            errorCount++;
                        }
                    }

                    hideLoader();
                    toastr.success(`批量导入完成！成功 ${successCount} 个，失败 ${errorCount} 个。`);
                    showRefreshNotification();
                    
                    event.target.value = ''; 
                });

                batchImportBtn.addEventListener('click', () => {
                    fileInput.click();
                });

                bgFileInput.addEventListener('change', async (event) => {
                    const files = event.target.files;
                    if (!files.length) return;
                
                    showLoader();
                    let successCount = 0;
                    let errorCount = 0;
                
                    for (const file of files) {
                        try {
                            const formData = new FormData();
                            formData.append('avatar', file);
                            await uploadBackground(formData);
                            successCount++;
                        } catch (err) {
                            console.error(`上传背景 "${file.name}" 时出错:`, err);
                            toastr.error(`上传背景 "${file.name}" 失败: ${err.message}`);
                            errorCount++;
                        }
                    }
                
                    hideLoader();
                    let message = `背景导入完成！成功 ${successCount} 个，失败 ${errorCount} 个。`;
                    if (errorCount > 0 && successCount > 0) {
                        toastr.warning(message);
                    } else if (errorCount > 0 && successCount === 0) {
                        toastr.error(message);
                    } else {
                        toastr.success(message);
                    }
                    
                    showRefreshNotification();

                    if (isManageBgMode) {
                        setTimeout(() => renderBackgroundManagerUI(), 100);
                    }
                });

                batchImportBgBtn.addEventListener('click', () => {
                    bgFileInput.click();
                });
                
                batchDeleteBgBtn.addEventListener('click', async () => {
                    if (selectedBackgrounds.size === 0) {
                        toastr.info('请先选择至少一个背景图。');
                        return;
                    }
                    if (!confirm(`确定要删除选中的 ${selectedBackgrounds.size} 个背景图吗？此操作不可撤销。`)) {
                        return;
                    }
                
                    showLoader();
                    let successCount = 0;
                    let errorCount = 0;
                
                    for (const bgFile of selectedBackgrounds) {
                        try {
                            await deleteBackground(bgFile);
                            successCount++;
                        } catch (err) {
                            console.error(`删除背景 "${bgFile}" 时出错:`, err);
                            toastr.error(`删除背景 "${bgFile}" 失败: ${err.message}`);
                            errorCount++;
                        }
                    }
                
                    hideLoader();
                    let message = `背景删除完成！成功 ${successCount} 个，失败 ${errorCount} 个。`;
                    if (errorCount > 0 && successCount > 0) {
                        toastr.warning(message);
                    } else if (errorCount > 0 && successCount === 0) {
                        toastr.error(message);
                    } else {
                        toastr.success(message);
                    }
                    
                    selectedBackgrounds.clear();
                    showRefreshNotification();
                    
                    if (isManageBgMode) {
                        setTimeout(() => renderBackgroundManagerUI(), 100);
                    }
                });
                
                document.querySelector('#batch-add-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const newTag = prompt('请输入要添加的新标签（文件夹名）：');
                    if (newTag && newTag.trim()) {
                        await performBatchRename(oldName => `[${newTag.trim()}] ${oldName}`);
                    }
                });
                
                document.querySelector('#batch-move-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const targetTag = prompt('请输入要移动到的目标分类（文件夹名）：');
                    
                    if (targetTag && targetTag.trim()) {
                        const sanitizedTag = targetTag.trim().replace(/[\\/:*?"<>|]/g, '');
                        if (sanitizedTag !== targetTag.trim()) {
                            toastr.warning(`分类名包含非法字符，已自动过滤为: "${sanitizedTag}"`);
                        }
                        if (!sanitizedTag) {
                            toastr.error('过滤后的分类名为空，操作已取消。');
                            return;
                        }
                        
                        await performBatchRename(oldName => `[${sanitizedTag}] ${oldName.replace(/\[.*?\]/g, '').trim()}`);
                    }
                });

                document.querySelector('#batch-delete-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const tagToRemove = prompt('请输入要移除的标签（等同于将所选美化从以该标签命名的文件夹移出）：');
                    if (tagToRemove && tagToRemove.trim()) {
                        await performBatchRename(oldName => oldName.replace(`[${tagToRemove.trim()}]`, '').trim());
                    }
                });
                document.querySelector('#batch-delete-btn').addEventListener('click', performBatchDelete);
                document.querySelector('#batch-dissolve-btn').addEventListener('click', performBatchDissolve);

                contentWrapper.addEventListener('click', async (event) => {
                    const target = event.target;
                    const button = target.closest('button');
                    const themeItem = target.closest('.theme-item');
                    const categoryTitle = target.closest('.theme-category-title');
                    const folderCheckbox = target.closest('.folder-select-checkbox');

                    if (isBatchEditMode && folderCheckbox) {
                        event.stopPropagation();
                        
                        const titleElement = folderCheckbox.closest('.theme-category-title');
                        const categoryName = titleElement.parentElement.dataset.categoryName;
                        
                        if (folderCheckbox.checked) {
                            selectedFoldersForBatch.add(categoryName);
                            titleElement.classList.add('selected-for-batch');
                        } else {
                            selectedFoldersForBatch.delete(categoryName);
                            titleElement.classList.remove('selected-for-batch');
                        }
                        return;
                    }

                    if (categoryTitle) {
                        if (button && button.classList.contains('rename-folder-btn')) {
                            event.stopPropagation();
                            const categoryDiv = categoryTitle.closest('.theme-category');
                            const oldFolderName = categoryDiv.dataset.categoryName;
                            const newFolderName = prompt('请输入新的文件夹名称:', oldFolderName);

                            if (newFolderName && newFolderName.trim() && newFolderName !== oldFolderName) {
                                showLoader();
                                const themesToRename = allParsedThemes.filter(t => t.tags.includes(oldFolderName));
                                let favoritesToUpdate = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
                                for (const theme of themesToRename) {
                                    const oldName = theme.value;
                                    const newName = oldName.replace(`[${oldFolderName}]`, `[${newFolderName.trim()}]`);
                                    const themeObject = allThemeObjects.find(t => t.name === oldName);
                                    if (themeObject) {
                                        await saveTheme({ ...themeObject, name: newName });
                                        await deleteTheme(oldName);
                                        manualUpdateOriginalSelect('rename', oldName, newName);
                                        const favIndex = favoritesToUpdate.indexOf(oldName);
                                        if (favIndex > -1) {
                                            favoritesToUpdate[favIndex] = newName;
                                        }
                                        if (themeBackgroundBindings[oldName]) {
                                            themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                            delete themeBackgroundBindings[oldName];
                                        }
                                    }
                                }
                                localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoritesToUpdate));
                                localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                hideLoader();
                                toastr.success(`文件夹 "${oldFolderName}" 已重命名为 "${newFolderName.trim()}"`);
                                showRefreshNotification();
                                await buildThemeUI();
                            }
                            return;
                        }
                        
                        if (button && button.classList.contains('move-folder-up-btn')) {
                            event.stopPropagation();
                            const currentCategory = categoryTitle.parentElement;
                            const prevCategory = currentCategory.previousElementSibling;
                            if (prevCategory && prevCategory.dataset.categoryName !== '⭐ 收藏夹') {
                                contentWrapper.insertBefore(currentCategory, prevCategory);
                                saveCategoryOrder();
                            }
                            return;
                        }
                        
                        if (button && button.classList.contains('move-folder-down-btn')) {
                            event.stopPropagation();
                            const currentCategory = categoryTitle.parentElement;
                            const nextCategory = currentCategory.nextElementSibling;
                            if (nextCategory && nextCategory.dataset.categoryName !== '未分类') {
                                contentWrapper.insertBefore(nextCategory, currentCategory);
                                saveCategoryOrder();
                            }
                            return;
                        }

                        if (button && button.classList.contains('dissolve-folder-btn')) {
                            event.stopPropagation();
                            const categoryName = categoryTitle.closest('.theme-category').dataset.categoryName;
                            if (!confirm(`确定要解散文件夹 "${categoryName}" 吗？`)) return;
                            
                            showLoader();
                            const themesToUpdate = Array.from(originalSelect.options).map(opt => opt.value).filter(name => name.includes(`[${categoryName}]`));
                            for (const oldName of themesToUpdate) {
                                const themeObject = allThemeObjects.find(t => t.name === oldName);
                                if (!themeObject) continue;
                                const newName = oldName.replace(`[${categoryName}]`, '').trim();
                                await saveTheme({ ...themeObject, name: newName });
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, newName);

                                const favIndex = favorites.indexOf(oldName);
                                if (favIndex > -1) {
                                    favorites[favIndex] = newName;
                                }

                                if (themeBackgroundBindings[oldName]) {
                                    themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                    delete themeBackgroundBindings[oldName];
                                }
                            }
                            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                            localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                            hideLoader();
                            toastr.success(`文件夹 "${categoryName}" 已解散！`);
                            showRefreshNotification();
                            await buildThemeUI();
                        } else {
                            if (isReorderMode) return;
                            const list = categoryTitle.nextElementSibling;
                            if (list) {
                                const isHidden = list.style.display === 'none';
                                list.style.display = isHidden ? 'block' : 'none';
                                
                                const categoryName = categoryTitle.parentElement.dataset.categoryName;
                                let collapsedFolders = JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY)) || [];
                                if (!isHidden) {
                                    if (!collapsedFolders.includes(categoryName)) {
                                        collapsedFolders.push(categoryName);
                                    }
                                } else {
                                    collapsedFolders = collapsedFolders.filter(name => name !== categoryName);
                                }
                                localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(collapsedFolders));
                            }
                        }
                        return;
                    }

                    if (!themeItem) return;
                    const themeName = themeItem.dataset.value;

                    if (isBatchEditMode) {
                        if (selectedForBatch.has(themeName)) {
                            selectedForBatch.delete(themeName);
                            themeItem.classList.remove('selected-for-batch');
                        } else {
                            selectedForBatch.add(themeName);
                            themeItem.classList.add('selected-for-batch');
                        }
                    } else {
                        const categoryName = themeItem.closest('.theme-category').dataset.categoryName;

                        if (button && button.classList.contains('link-bg-btn')) {
                            isBindingMode = true;
                            themeNameToBind = themeName;
                            // 尝试点击新版按钮，如果不存在，则点击旧版按钮
                            const toggleButton = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                            if (toggleButton) {
                                toggleButton.click();
                            }
                            toastr.info('请在背景面板中选择一张图片进行绑定。', '进入背景绑定模式');
                            return;
                        }

                        if (button && button.classList.contains('unbind-bg-btn')) {
                            delete themeBackgroundBindings[themeName];
                            localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                            toastr.success(`主题 "${themeItem.querySelector('.theme-item-name').textContent}" 已解绑背景。`);
                            await buildThemeUI();
                            return;
                        }

                        if (button && button.classList.contains('favorite-btn')) {
                            if (favorites.includes(themeName)) {
                                favorites = favorites.filter(f => f !== themeName);
                                // 取消收藏：变为空心星星
                                button.innerHTML = '<i class="fa-regular fa-star"></i>';
                            } else {
                                favorites.push(themeName);
                                // 添加收藏：变为实心星星
                                button.innerHTML = '<i class="fa-solid fa-star"></i>';
                            }
                            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                            await buildThemeUI();
                        }
                        else if (button && button.classList.contains('rename-btn')) {
                            const oldName = themeName;
                            const newName = prompt(`请输入新名称：`, oldName);
                            if (newName && newName !== oldName) {
                                const themeObject = allThemeObjects.find(t => t.name === oldName);
                                if (!themeObject) return;
                                await saveTheme({ ...themeObject, name: newName });
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, newName);

                                const favIndex = favorites.indexOf(oldName);
                                if (favIndex > -1) {
                                    favorites[favIndex] = newName;
                                    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                                }

                                if (themeBackgroundBindings[oldName]) {
                                    themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                    delete themeBackgroundBindings[oldName];
                                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                }
                                
                                showRefreshNotification();
                                await buildThemeUI();
                            }
                        }
                        else if (button && button.classList.contains('delete-btn')) {
                            if (confirm(`确定要删除主题 "${themeItem.querySelector('.theme-item-name').textContent}" 吗？`)) {
                                const isCurrentlyActive = originalSelect.value === themeName;
                                await deleteTheme(themeName);
                                manualUpdateOriginalSelect('delete', themeName);

                                if (themeBackgroundBindings[themeName]) {
                                    delete themeBackgroundBindings[themeName];
                                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                }

                                if (isCurrentlyActive) {
                                    const azureOption = originalSelect.querySelector('option[value="Azure"]');
                                    originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                                    originalSelect.dispatchEvent(new Event('change'));
                                }
                                showRefreshNotification();
                                await buildThemeUI();
                            }
                        } else {
                            originalSelect.value = themeName;
                            originalSelect.dispatchEvent(new Event('change'));
                        }
                    }
                });

                originalSelect.addEventListener('change', (event) => {
                    updateActiveState();
                    const newThemeName = event.target.value;
                    const boundBg = themeBackgroundBindings[newThemeName];
                    if (boundBg) {
                        const bgElement = document.querySelector(`#bg_menu_content .bg_example[bgfile="${boundBg}"], #bg_custom_content .bg_example[bgfile="${boundBg}"]`);
                        if (bgElement) {
                            bgElement.click();
                        }
                    }
                });

                const observer = new MutationObserver((mutations) => {
                    if (!isManageBgMode) {
                        buildThemeUI();
                    }
                });
                observer.observe(originalSelect, { childList: true, subtree: true, characterData: true });

                const bgMenuContent = document.getElementById('bg_menu_content');
                const bgCustomContent = document.getElementById('bg_custom_content');
                
                const bgObserverCallback = async (e) => {
                    if (!isBindingMode) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const bgElement = e.target.closest('.bg_example');
                    if (!bgElement) return;

                    const bgFileName = bgElement.getAttribute('bgfile');
                    themeBackgroundBindings[themeNameToBind] = bgFileName;
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));

                    toastr.success(`背景已成功绑定到主题！`);

                    isBindingMode = false;
                    themeNameToBind = null;
                    
                    // 尝试点击新版按钮，如果不存在，则点击旧版按钮
                    const toggleButton = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                    if (toggleButton) {
                        toggleButton.click();
                    }

                    setTimeout(() => {
                        const userSettingsPanel = document.querySelector('#user-settings-block');
                        if (userSettingsPanel && userSettingsPanel.classList.contains('closedDrawer')) {
                            document.querySelector('#user-settings-button .drawer-toggle').click();
                        }
                    }, 150);

                    await buildThemeUI();
                };

                if (bgMenuContent) bgMenuContent.addEventListener('click', bgObserverCallback, true);
                if (bgCustomContent) bgCustomContent.addEventListener('click', bgObserverCallback, true);

                // ==========================================================
                // ========= 新增功能：角色卡绑定美化 (Character Theme Binding) =========
                // ==========================================================

                // 绑定主题按钮的点击事件
                document.body.addEventListener('click', async (event) => {
                    if (event.target.id !== 'link-theme-btn') return;

                    const chid = document.querySelector('#rm_ch_create_block #avatar_url_pole')?.value;
                    if (!chid) {
                        toastr.warning('请先选择一个角色。');
                        return;
                    }

                    let bindings = JSON.parse(localStorage.getItem(CHARACTER_THEME_BINDINGS_KEY)) || {};
                    const currentBinding = bindings[chid] || '';
                    let selectedValue = currentBinding;

                    const popupContent = document.createElement('div');
                    popupContent.innerHTML = `<h4>为角色绑定美化</h4><p>选择一个美化主题，在下次加载此角色时将自动应用。</p>`;

                    const select = document.createElement('select');
                    select.id = 'theme-binding-select';
                    select.className = 'text_pole';

                    const noBindingOption = document.createElement('option');
                    noBindingOption.value = '';
                    noBindingOption.textContent = '— 无绑定 —';
                    select.appendChild(noBindingOption);

                    document.querySelectorAll('#themes option').forEach(option => {
                        if (option.value) {
                            const newOption = option.cloneNode(true);
                            select.appendChild(newOption);
                        }
                    });

                    select.value = currentBinding;
                    popupContent.appendChild(select);
                    
                    await callGenericPopup(popupContent, 'confirm', null, {
                        okButton: '保存',
                        cancelButton: '取消',
                        wide: true,
                        onOpen: (popup) => {
                            const dialogElement = popup.dlg;
                            const selectElement = dialogElement.querySelector('#theme-binding-select');
                            const okButton = dialogElement.querySelector('.popup-button-ok');
                            const cancelButton = dialogElement.querySelector('.popup-button-cancel');

                            // ### 最终核心修复：移除 placeholder ###
                            setTimeout(() => {
                                $(selectElement).select2({
                                    dropdownParent: $(dialogElement),
                                    width: '100%'
                                    // placeholder 选项已被移除
                                }).on('change', (e) => {
                                    selectedValue = $(e.target).val();
                                });
                            }, 0);

                            okButton.addEventListener('click', (e) => {
                                e.preventDefault();
                                const newBinding = selectedValue;
                                if (newBinding) {
                                    bindings[chid] = newBinding;
                                    toastr.success(`已将角色绑定到美化：<b>${newBinding}</b>`, '', { escapeHtml: false });
                                } else {
                                    delete bindings[chid];
                                    toastr.info('已取消此角色的美化绑定。');
                                }
                                localStorage.setItem(CHARACTER_THEME_BINDINGS_KEY, JSON.stringify(bindings));
                                cancelButton.click();
                            });
                        }
                    });
                });

                // 监听角色卡片的点击事件以自动应用美化
                document.getElementById('right-nav-panel').addEventListener('click', (event) => {
                    const characterBlock = event.target.closest('.character_select');
                    if (!characterBlock) return;
                    
                    setTimeout(() => {
                        // 使用 SillyTavern.getContext() 来安全地访问全局变量
                        const characters = SillyTavern.getContext().characters;
                        const chid = characterBlock.dataset.chid;
                        const character = characters[chid];

                        if (!character || !character.avatar) return;

                        const bindings = JSON.parse(localStorage.getItem(CHARACTER_THEME_BINDINGS_KEY)) || {};
                        const boundTheme = bindings[character.avatar];

                        if (boundTheme) {
                            const themeSelect = document.querySelector('#themes');
                            const themeOption = themeSelect.querySelector(`option[value="${boundTheme}"]`);

                            if (themeOption && themeSelect.value !== boundTheme) {
                                console.log(`[Theme Manager] Applying bound theme via click: ${boundTheme}`);
                                themeSelect.value = boundTheme;
                                themeSelect.dispatchEvent(new Event('change'));
                                toastr.info(`已自动应用角色绑定的美化：<b>${boundTheme}</b>`, '', {timeOut: 2000, escapeHtml: false});
                            }
                        }
                    }, 50);
                });

                // 监听欢迎页面“最近的聊天”列表的点击事件，以自动应用美化
                document.getElementById('chat').addEventListener('click', (event) => {
                    // 1. 检查点击的是否是聊天记录项
                    const recentChatBlock = event.target.closest('.recentChat');

                    // 如果不是，或者找不到，就直接退出
                    if (!recentChatBlock) return;

                    // 2. 从 data-avatar 属性直接获取角色头像文件名
                    const characterAvatar = recentChatBlock.dataset.avatar;
                    if (!characterAvatar) return;

                    // 使用一个短暂的延时，确保SillyTavern的其他点击处理已完成
                    setTimeout(() => {
                        // 3. 接下来的逻辑与你已有的功能完全相同
                        const bindings = JSON.parse(localStorage.getItem(CHARACTER_THEME_BINDINGS_KEY)) || {};
                        const boundTheme = bindings[characterAvatar];

                        if (boundTheme) {
                            const themeSelect = document.querySelector('#themes');
                            const themeOption = themeSelect.querySelector(`option[value="${boundTheme}"]`);

                            if (themeOption && themeSelect.value !== boundTheme) {
                                console.log(`[Theme Manager] 从欢迎页应用绑定的美化: ${boundTheme}`);
                                themeSelect.value = boundTheme;
                                themeSelect.dispatchEvent(new Event('change'));
                                toastr.info(`已自动应用角色绑定的美化：<b>${boundTheme}</b>`, '', {timeOut: 2000, escapeHtml: false});
                            }
                        }
                    }, 50); // 50毫秒的延时通常足够了
                });

                // ==========================================================
                // ======================= 功能结束 =========================
                // ==========================================================


                buildThemeUI().then(() => {
                    // 动态添加“绑定主题”按钮
                    const controlsInterval = setInterval(() => {
                        const controlsContainer = document.querySelector('#avatar_controls .form_create_bottom_buttons_block');
                        if (controlsContainer && !document.querySelector('#link-theme-btn')) {
                            clearInterval(controlsInterval);
                            const linkButton = document.createElement('div');
                            linkButton.id = 'link-theme-btn';
                            linkButton.className = 'menu_button fa-solid fa-link';
                            linkButton.title = '为此角色绑定一个主题';
                            linkButton.setAttribute('data-i18n', '[title]为此角色绑定一个主题');
                            controlsContainer.appendChild(linkButton);
                        }
                    }, 500);
                    const isInitiallyCollapsed = localStorage.getItem(COLLAPSE_KEY) !== 'false';
                    setCollapsed(isInitiallyCollapsed, false);
                });

            } catch (error) {
                console.error("Theme Manager: 初始化过程中发生错误:", error);
            }
        }
    }, 250);
})();

