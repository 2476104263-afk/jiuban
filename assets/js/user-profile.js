import { $, el, modal, toast } from './util.js';

const PROFILE_KEY = 'jiuban.profile.v1';
const DEFAULT_PROFILE = { name: '我', avatarData: '' };

export function getUserProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_PROFILE };
    return {
      name: String(saved.name || DEFAULT_PROFILE.name).trim().slice(0, 24) || DEFAULT_PROFILE.name,
      avatarData: typeof saved.avatarData === 'string' && saved.avatarData.startsWith('data:image/') ? saved.avatarData : '',
    };
  } catch (error) {
    return { ...DEFAULT_PROFILE };
  }
}

function imageToAvatar(file) {
  if (!file || !file.type.startsWith('image/')) return Promise.reject(new Error('请选择图片文件。'));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('图片不能超过 8 MB。'));
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 512;
        canvas.width = size;
        canvas.height = size;
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const x = (image.naturalWidth - side) / 2;
        const y = (image.naturalHeight - side) / 2;
        const context = canvas.getContext('2d');
        context.drawImage(image, x, y, side, side, 0, 0, size, size);
        const result = canvas.toDataURL('image/jpeg', 0.86);
        if (result.length > 1_400_000) throw new Error('图片压缩后仍然过大，请换一张图片。');
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('无法读取这张图片。'));
    };
    image.src = objectUrl;
  });
}

function paintPreview(preview, image, letter, profile) {
  letter.textContent = profile.name.slice(0, 1) || '我';
  if (profile.avatarData) {
    image.src = profile.avatarData;
    image.hidden = false;
    letter.hidden = true;
  } else {
    image.removeAttribute('src');
    image.hidden = true;
    letter.hidden = false;
  }
  preview.setAttribute('aria-label', `${profile.name}的头像预览`);
}

export function initUserProfile(onChange = () => {}) {
  const button = $('#me-avatar');
  const image = $('#me-avatar-image');
  const letter = button?.querySelector('.me-letter');
  if (!button || !image || !letter) return;

  let profile = getUserProfile();
  const render = () => {
    letter.textContent = profile.name.slice(0, 1) || '我';
    if (profile.avatarData) {
      image.src = profile.avatarData;
      image.hidden = false;
      letter.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      letter.hidden = false;
    }
    button.title = `${profile.name} · 编辑个人资料`;
    button.setAttribute('aria-label', `个人资料：${profile.name}`);
  };

  function openEditor() {
    const draft = { ...profile };
    const nameInput = el('input', { class: 'input', type: 'text', maxlength: 24, value: draft.name, autocomplete: 'nickname', 'aria-label': '账户名称' });
    const preview = el('div', { class: 'profile-avatar-preview' });
    const previewImage = el('img', { class: 'profile-avatar-preview-image', alt: '', hidden: true });
    const previewLetter = el('span', { class: 'profile-avatar-preview-letter', text: draft.name.slice(0, 1) || '我' });
    preview.append(previewImage, previewLetter);
    const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
    const chooseButton = el('button', { class: 'btn btn-soft', type: 'button', text: '选择头像图片', onClick: () => fileInput.click() });
    const removeButton = el('button', { class: 'btn btn-ghost', type: 'button', text: '恢复文字头像', onClick: () => {
      draft.avatarData = '';
      paintPreview(preview, previewImage, previewLetter, draft);
    } });
    const status = el('p', { class: 'profile-editor-hint', text: '图片会裁切为正方形并保存在这台设备的浏览器中。' });
    const body = el('div', { class: 'profile-editor' }, [
      el('div', { class: 'profile-editor-avatar-row' }, [preview, el('div', { class: 'profile-editor-avatar-actions' }, [chooseButton, removeButton])]),
      el('label', { class: 'profile-editor-label', text: '账户名称' }),
      nameInput,
      status,
      fileInput,
    ]);
    const dialog = modal({
      title: '个人资料',
      body,
      footer: [
        el('button', { class: 'btn btn-ghost', type: 'button', onClick: () => dialog.close() }, '取消'),
        el('button', { class: 'btn btn-primary', type: 'button', onClick: () => {
          const name = nameInput.value.trim();
          if (!name) {
            toast('账户名称不能为空。', 'warning');
            nameInput.focus();
            return;
          }
          try {
            const next = { name: name.slice(0, 24), avatarData: draft.avatarData };
            localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
            profile = next;
            render();
            onChange(profile);
            dialog.close();
            toast('个人资料已保存', 'success');
          } catch (error) {
            toast('保存失败，请换一张较小的图片后重试。', 'error');
          }
        } }, '保存'),
      ],
    });

    nameInput.addEventListener('input', () => {
      draft.name = nameInput.value.trim() || '我';
      paintPreview(preview, previewImage, previewLetter, draft);
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      chooseButton.disabled = true;
      status.textContent = '正在处理头像…';
      try {
        draft.avatarData = await imageToAvatar(file);
        paintPreview(preview, previewImage, previewLetter, draft);
        status.textContent = '头像已准备好，保存后会显示在左上角。';
      } catch (error) {
        status.textContent = error.message;
        toast(error.message, 'warning');
      } finally {
        chooseButton.disabled = false;
      }
    });
    paintPreview(preview, previewImage, previewLetter, draft);
  }

  render();
  button.addEventListener('click', openEditor);
}
