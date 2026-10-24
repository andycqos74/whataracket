import type { FreeCell, LocalDate, VenueSettings } from '@whataracket/domain';
import { getJson } from './http.js';
import type { HttpOptions } from './http.js';
import { parseSettings, parseVenueSessions } from './parse.js';

export interface ClubSparkClientOptions {
  /** Default `clubspark.lta.org.uk`. */
  host?: string;
  /** See {@link ParseSettingsOptions.roleName}. */
  roleName?: string | undefined;
  userAgent?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  fetchJson?: (url: URL) => Promise<unknown>;
}

/** Availability and settings: public endpoints, no login. */
export interface AvailabilitySource {
  getSettings(venue: string): Promise<VenueSettings>;
  getFreeCells(venue: string, from: LocalDate, to: LocalDate): Promise<FreeCell[]>;
}

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; whataracket/0.1; personal court-availability checker)';

export class ClubSparkClient implements AvailabilitySource {
  private readonly host: string;
  private readonly roleName: string | undefined;
  private readonly fetchJson: (url: URL) => Promise<unknown>;

  constructor(options: ClubSparkClientOptions = {}) {
    this.host = options.host ?? 'clubspark.lta.org.uk';
    this.roleName = options.roleName;
    const http: HttpOptions = { userAgent: options.userAgent ?? DEFAULT_USER_AGENT, timeoutMs: options.timeoutMs ?? 20_000 };
    this.fetchJson = options.fetchJson ?? ((url) => getJson(url, http));
  }

  settingsUrl(venue: string): URL {
    return new URL(`https://${this.host}/v0/VenueBooking/${encodeURIComponent(venue)}/GetSettings`);
  }

  sessionsUrl(venue: string, from: LocalDate, to: LocalDate): URL {
    const url = new URL(`https://${this.host}/v0/VenueBooking/${encodeURIComponent(venue)}/GetVenueSessions`);
    url.search = new URLSearchParams({ resourceID: '', startDate: from, endDate: to, roleId: '' }).toString();
    return url;
  }

  async getSettings(venue: string): Promise<VenueSettings> {
    return parseSettings(await this.fetchJson(this.settingsUrl(venue)), { roleName: this.roleName });
  }

  async getFreeCells(venue: string, from: LocalDate, to: LocalDate): Promise<FreeCell[]> {
    return parseVenueSessions(await this.fetchJson(this.sessionsUrl(venue, from, to)));
  }
}
