
import { Show, GameTemplate, Category, TemplateConfig } from '../types';
import { logger } from './logger';
import { normalizeTemplateConfigForTeams } from './teamsMode';
import { apiRequest } from './apiClient';
import { usesFirebaseDataSource } from './runtimeEnvironment';

const STORAGE_KEYS = {
  SHOWS: 'cruzpham_db_shows',
  TEMPLATES: 'cruzpham_db_templates',
};

class DataService {
  private showsCache: Show[] = [];
  private templatesCacheByShow = new Map<string, GameTemplate[]>();

  private useFirebase(): boolean {
    return usesFirebaseDataSource();
  }

  private getShowsDB(): Show[] {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.SHOWS) || '[]');
  }

  private saveShowsDB(shows: Show[]) {
    localStorage.setItem(STORAGE_KEYS.SHOWS, JSON.stringify(shows));
  }

  private getTemplatesDB(): GameTemplate[] {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.TEMPLATES) || '[]');
  }

  private saveTemplatesDB(templates: GameTemplate[]) {
    localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
  }

  // --- SHOWS ---

  getShowsForUser(username: string): Show[] {
    if (this.useFirebase()) {
      return this.showsCache
        .filter(s => s.userId === username)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const allShows = this.getShowsDB();
    return allShows.filter(s => s.userId === username).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getShowsForUserAsync(username: string): Promise<Show[]> {
    if (!this.useFirebase()) return this.getShowsForUser(username);
    this.showsCache = await apiRequest<Show[]>(`/shows?username=${encodeURIComponent(username)}`);
    return this.getShowsForUser(username);
  }

  getShowById(id: string): Show | undefined {
    if (this.useFirebase()) {
      return this.showsCache.find(s => s.id === id);
    }

    const allShows = this.getShowsDB();
    return allShows.find(s => s.id === id);
  }

  async getShowByIdAsync(id: string): Promise<Show | undefined> {
    if (!this.useFirebase()) return this.getShowById(id);
    const show = await apiRequest<Show | null>(`/shows/${encodeURIComponent(id)}`);
    if (show && !this.showsCache.some((s) => s.id === show.id)) {
      this.showsCache = [show, ...this.showsCache];
    }
    return show || undefined;
  }

  createShow(username: string, title: string): Show | Promise<Show> {
    if (this.useFirebase()) {
      return apiRequest<Show>('/shows', {
        method: 'POST',
        body: JSON.stringify({ username, title }),
      }).then((show) => {
        this.showsCache = [show, ...this.showsCache.filter((s) => s.id !== show.id)];
        return show;
      });
    }

    const newShow: Show = {
      id: crypto.randomUUID(),
      userId: username,
      title,
      createdAt: new Date().toISOString()
    };
    const shows = this.getShowsDB();
    shows.push(newShow);
    this.saveShowsDB(shows);
    logger.info(`[DataService] Created show: ${title} for ${username}`);
    return newShow;
  }

  // --- TEMPLATES ---

  getTemplatesForShow(showId: string): GameTemplate[] {
    if (this.useFirebase()) {
      return [...(this.templatesCacheByShow.get(showId) || [])]
        .map((template) => ({ ...template, config: normalizeTemplateConfigForTeams(template.config) }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const all = this.getTemplatesDB();
    return all
      .filter(t => t.showId === showId)
      .map((template) => ({ ...template, config: normalizeTemplateConfigForTeams(template.config) }))
      .sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  async getTemplatesForShowAsync(showId: string): Promise<GameTemplate[]> {
    if (!this.useFirebase()) return this.getTemplatesForShow(showId);
    const templates = await apiRequest<GameTemplate[]>(`/templates?showId=${encodeURIComponent(showId)}`);
    this.templatesCacheByShow.set(showId, templates);
    return this.getTemplatesForShow(showId);
  }

  createTemplate(showId: string, topic: string, config: TemplateConfig, categories: Category[]): GameTemplate | Promise<GameTemplate> {
    if (this.useFirebase()) {
      return apiRequest<GameTemplate>('/templates', {
        method: 'POST',
        body: JSON.stringify({ showId, topic, config: normalizeTemplateConfigForTeams(config), categories }),
      }).then((template) => {
        const existing = this.templatesCacheByShow.get(showId) || [];
        this.templatesCacheByShow.set(showId, [template, ...existing.filter((t) => t.id !== template.id)]);
        return template;
      });
    }

    const currentTemplates = this.getTemplatesForShow(showId);
    if (currentTemplates.length >= 40) {
      throw new Error('LIMIT_REACHED');
    }

    const newTemplate: GameTemplate = {
      id: crypto.randomUUID(),
      showId,
      topic,
      config: normalizeTemplateConfigForTeams(config),
      categories,
      createdAt: new Date().toISOString()
    };

    const all = this.getTemplatesDB();
    all.push(newTemplate);
    this.saveTemplatesDB(all);
    logger.info(`[DataService] Saved template: ${topic} for show ${showId}`);
    return newTemplate;
  }

  updateTemplate(template: GameTemplate): void | Promise<void> {
    if (this.useFirebase()) {
      const normalized = {
        ...template,
        config: normalizeTemplateConfigForTeams(template.config),
        lastModified: new Date().toISOString(),
      };
      return apiRequest<GameTemplate>(`/templates/${encodeURIComponent(template.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ template: normalized }),
      }).then((updated) => {
        const existing = this.templatesCacheByShow.get(updated.showId) || [];
        this.templatesCacheByShow.set(updated.showId, existing.map((t) => t.id === updated.id ? updated : t));
      });
    }

    let all = this.getTemplatesDB();
    const idx = all.findIndex(t => t.id === template.id);
    if (idx !== -1) {
      all[idx] = {
        ...template,
        config: normalizeTemplateConfigForTeams(template.config),
        lastModified: new Date().toISOString(),
      };
      this.saveTemplatesDB(all);
      logger.info(`[DataService] Updated template: ${template.id}`);
    }
  }

  deleteTemplate(templateId: string): void | Promise<void> {
    if (this.useFirebase()) {
      return apiRequest<{ showId: string }>(`/templates/${encodeURIComponent(templateId)}`, {
        method: 'DELETE',
      }).then(({ showId }) => {
        const existing = this.templatesCacheByShow.get(showId) || [];
        this.templatesCacheByShow.set(showId, existing.filter((t) => t.id !== templateId));
      });
    }

    let all = this.getTemplatesDB();
    all = all.filter(t => t.id !== templateId);
    this.saveTemplatesDB(all);
    logger.info(`[DataService] Deleted template: ${templateId}`);
  }

  importTemplate(showId: string, jsonContent: string): GameTemplate | Promise<GameTemplate> {
    if (this.useFirebase()) {
      return apiRequest<GameTemplate>('/templates/import', {
        method: 'POST',
        body: JSON.stringify({ showId, jsonContent }),
      }).then((template) => {
        const existing = this.templatesCacheByShow.get(showId) || [];
        this.templatesCacheByShow.set(showId, [template, ...existing.filter((t) => t.id !== template.id)]);
        return template;
      });
    }

    const currentTemplates = this.getTemplatesForShow(showId);
    if (currentTemplates.length >= 40) throw new Error('LIMIT_REACHED');

    let parsed: any;
    try {
      parsed = JSON.parse(jsonContent);
    } catch (e) {
      throw new Error('INVALID_JSON');
    }

    // Validation
    if (!parsed.topic || !Array.isArray(parsed.categories) || !parsed.config) {
      throw new Error('INVALID_SCHEMA');
    }
    
    // Constraint Checks
    if (parsed.categories.length > 8 || parsed.config.rowCount > 10 || parsed.config.playerCount > 8) {
      throw new Error('CONSTRAINT_VIOLATION');
    }

    // Sanitize and re-ID
    const newTemplate: GameTemplate = {
      id: crypto.randomUUID(),
      showId, // Force to current show
      topic: parsed.topic + ' (Imported)',
      config: normalizeTemplateConfigForTeams(parsed.config),
      categories: parsed.categories.map((c: any) => ({
        ...c,
        id: crypto.randomUUID(),
        questions: c.questions.map((q: any) => ({
          ...q,
          id: crypto.randomUUID(),
          isRevealed: false,
          isAnswered: false
        }))
      })),
      createdAt: new Date().toISOString()
    };

    const all = this.getTemplatesDB();
    all.push(newTemplate);
    this.saveTemplatesDB(all);
    return newTemplate;
  }
}

export const dataService = new DataService();
