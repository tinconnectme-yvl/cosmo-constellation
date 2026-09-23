import { sound } from './audio_fx.js';

class ToastManager {
    constructor() {
        this.container = null;
    }

    getContainer() {
        if (!this.container && typeof document !== 'undefined') {
            this.container = document.getElementById('toastContainer');
            if (!this.container && document.body) {
                this.container = document.createElement('div');
                this.container.id = 'toastContainer';
                this.container.className = 'toast-container';
                document.body.appendChild(this.container);
            }
        }
        return this.container;
    }

    show({ type = 'info', title = '', message = '', duration = 4200 }) {
        const toast = document.createElement('div');
        toast.className = `custom-toast toast-${type}`;

        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: '🛰️'
        };

        toast.innerHTML = `
            <div class="toast-icon-box">${icons[type] || 'ℹ'}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-msg">${message}</div>
            </div>
            <button class="toast-close" title="Закрыть">✕</button>
            <div class="toast-progress">
                <div class="toast-progress-bar" style="animation-duration:${duration}ms;"></div>
            </div>
        `;

        const closeBtn = toast.querySelector('.toast-close');
        let timer = null;

        const dismiss = () => {
            if (timer) clearTimeout(timer);
            toast.classList.add('toast-leaving');
            setTimeout(() => {
                if (toast.parentElement) toast.parentElement.removeChild(toast);
            }, 300);
        };

        closeBtn.addEventListener('click', dismiss);
        timer = setTimeout(dismiss, duration);
        const container = this.getContainer();
        if (container) {
            container.appendChild(toast);
        }

        // Звуковое сопровождение
        if (type === 'success') {
            sound.playSuccess();
        } else if (type === 'error') {
            sound.playCrash();
        } else if (type === 'warning') {
            sound.playBeep();
        } else {
            sound.playClick();
        }
    }

    success(title, message, duration) {
        this.show({ type: 'success', title, message, duration });
    }

    error(title, message, duration) {
        this.show({ type: 'error', title, message, duration });
    }

    warning(title, message, duration) {
        this.show({ type: 'warning', title, message, duration });
    }

    info(title, message, duration) {
        this.show({ type: 'info', title, message, duration });
    }
}

export const toast = new ToastManager();
