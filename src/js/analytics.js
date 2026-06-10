// Analytics Module - Dismiss Pattern Analysis

/**
 * Get statistics per tip - total dismisses and breakdown by reason
 * @returns {Array} Array of tip statistics with dismiss breakdown
 */
async function getStatsPerTip() {
  try {
    const tips = await window.electronAPI.dbQuery(`
      SELECT t.id, t.content, t.importance, c.name as category_name, c.color as category_color
      FROM tips t
      JOIN categories c ON t.category_id = c.id
      WHERE t.status != 'done'
      ORDER BY c.name, t.importance DESC
    `);

    const stats = [];
    
    for (const tip of tips) {
      // Get dismiss logs for this tip
      const dismissLogs = await window.electronAPI.dbQuery(`
        SELECT reason, COUNT(*) as count
        FROM dismiss_log
        WHERE tip_id = ?
        GROUP BY reason
      `, [tip.id]);

      // Build breakdown
      const breakdown = {
        no_time: 0,
        dont_know_how: 0,
        no_motivation: 0,
        not_now: 0,
        null: 0,
        completed: 0
      };

      let totalDismisses = 0;
      
      dismissLogs.forEach(log => {
        const reason = log.reason || 'null';
        if (breakdown.hasOwnProperty(reason)) {
          breakdown[reason] = log.count;
          totalDismisses += log.count;
        }
      });

      // Find most common reason
      let mostCommonReason = null;
      let maxCount = 0;
      for (const [reason, count] of Object.entries(breakdown)) {
        if (count > maxCount && reason !== 'completed') {
          maxCount = count;
          mostCommonReason = reason;
        }
      }

      stats.push({
        tip: tip,
        totalDismisses,
        breakdown,
        mostCommonReason,
        mostCommonCount: maxCount,
        patternWarning: maxCount >= 3 ? mostCommonReason : null
      });
    }

    return stats;
  } catch (error) {
    console.error('Error getting stats per tip:', error);
    return [];
  }
}

/**
 * Get statistics per category - aggregate dismiss patterns
 * @returns {Array} Array of category statistics
 */
async function getStatsPerCategory() {
  try {
    const categories = await window.electronAPI.dbQuery(`
      SELECT id, name, color
      FROM categories
      ORDER BY name
    `);

    const stats = [];

    for (const category of categories) {
      // Get all dismiss logs for tips in this category
      const dismissLogs = await window.electronAPI.dbQuery(`
        SELECT dl.reason, COUNT(*) as count
        FROM dismiss_log dl
        JOIN tips t ON dl.tip_id = t.id
        WHERE t.category_id = ? AND t.status != 'done'
        GROUP BY dl.reason
      `, [category.id]);

      // Build breakdown
      const breakdown = {
        no_time: 0,
        dont_know_how: 0,
        no_motivation: 0,
        not_now: 0,
        null: 0,
        completed: 0
      };

      let totalDismisses = 0;

      dismissLogs.forEach(log => {
        const reason = log.reason || 'null';
        if (breakdown.hasOwnProperty(reason)) {
          breakdown[reason] = log.count;
          totalDismisses += log.count;
        }
      });

      // Get tip count for this category
      const tipCount = await window.electronAPI.dbQuery(`
        SELECT COUNT(*) as count
        FROM tips
        WHERE category_id = ? AND status != 'done'
      `, [category.id]);

      // Find most common reason
      let mostCommonReason = null;
      let maxCount = 0;
      for (const [reason, count] of Object.entries(breakdown)) {
        if (count > maxCount && reason !== 'completed') {
          maxCount = count;
          mostCommonReason = reason;
        }
      }

      stats.push({
        category,
        tipCount: tipCount[0].count,
        totalDismisses,
        breakdown,
        mostCommonReason,
        mostCommonCount: maxCount,
        patternWarning: maxCount >= 3 ? mostCommonReason : null
      });
    }

    return stats;
  } catch (error) {
    console.error('Error getting stats per category:', error);
    return [];
  }
}

/**
 * Get top patterns across all tips - identify recurring dismiss reasons
 * @returns {Array} Array of pattern insights
 */
async function getTopPatterns() {
  try {
    const tipStats = await getStatsPerTip();
    const patterns = [];

    // Collect tips with pattern warnings
    tipStats.forEach(stat => {
      if (stat.patternWarning) {
        patterns.push({
          type: 'tip',
          tip: stat.tip,
          reason: stat.patternWarning,
          count: stat.mostCommonCount,
          message: `Bu konuyu ${stat.mostCommonCount} kez '${getReasonLabel(stat.patternWarning)}' diyerek geçtin`
        });
      }
    });

    // Collect category-level patterns
    const categoryStats = await getStatsPerCategory();
    categoryStats.forEach(stat => {
      if (stat.patternWarning && stat.tipCount > 1) {
        patterns.push({
          type: 'category',
          category: stat.category,
          reason: stat.patternWarning,
          count: stat.mostCommonCount,
          message: `"${stat.category.name}" kategorisinde ${stat.mostCommonCount} kez '${getReasonLabel(stat.patternWarning)}' sebebiyle geçtin`
        });
      }
    });

    // Sort by count (most frequent patterns first)
    patterns.sort((a, b) => b.count - a.count);

    return patterns;
  } catch (error) {
    console.error('Error getting top patterns:', error);
    return [];
  }
}

/**
 * Get human-readable label for dismiss reason
 * @param {string} reason - The reason code
 * @returns {string} Human-readable label
 */
function getReasonLabel(reason) {
  const labels = {
    'no_time': 'Zaman yok',
    'dont_know_how': 'Bilmiyorum',
    'no_motivation': 'Motivasyon yok',
    'not_now': 'Şimdi değil',
    'null': 'Seçmedi',
    'completed': 'Tamamlandı'
  };
  return labels[reason] || reason;
}

/**
 * Get color for dismiss reason (for UI visualization)
 * @param {string} reason - The reason code
 * @returns {string} CSS color
 */
function getReasonColor(reason) {
  const colors = {
    'no_time': '#FFA502',
    'dont_know_how': '#00D9FF',
    'no_motivation': '#FF4757',
    'not_now': '#6C63FF',
    'null': '#a0a0a0',
    'completed': '#00FF88'
  };
  return colors[reason] || '#a0a0a0';
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getStatsPerTip,
    getStatsPerCategory,
    getTopPatterns,
    getReasonLabel,
    getReasonColor
  };
}
