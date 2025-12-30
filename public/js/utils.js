/**
 * Utility Functions
 * Hjälpfunktioner för formatering och beräkningar
 */

const Utils = {
    /**
     * Debounce - vänta tills användaren slutat skriva innan funktionen körs
     * @param {Function} func - Funktionen som ska köras
     * @param {number} wait - Millisekunder att vänta (default 400ms)
     * @returns {Function} - Debounced funktion
     */
    debounce(func, wait = 400) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Formatera nummer med tusentalsavskiljare
     */
    formatNumber(num) {
        if (num === null || num === undefined) return '0';
        return Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    },

    /**
     * Formatera vikt - konvertera till ton om över 1000 kg
     */
    formatWeight(kg) {
        if (kg >= 1000) {
            return (kg / 1000).toFixed(2) + ' ton';
        }
        return kg.toFixed(0) + ' kg';
    },

    /**
     * Formatera pris
     */
    formatPrice(price) {
        if (price === null || price === undefined) return '0 kr';
        return this.formatNumber(price) + ' kr';
    }
};

window.Utils = Utils;
