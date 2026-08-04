/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SSEMessage {
  type: 'progress' | 'chunk' | 'result' | 'error' | 'done' | 'stage' | 'complete' | 'heartbeat';
  message?: string;
  progress?: number;
  word_count?: number;
  status?: 'processing' | 'success' | 'error' | 'warning';
  content?: string;
  data?: any;
  error?: string;
  code?: number;
  stage?: string;
  total_segments?: number;
  segment_index?: number;
}

export interface SSEClientOptions {
  onProgress?: (message: string, progress: number, status: string, wordCount?: number) => void;
  onChunk?: (content: string, segmentIndex?: number) => void;
  onResult?: (data: any) => void;
  onError?: (error: string, code?: number) => void;
  onComplete?: () => void;
  onConnectionError?: (error: Event) => void;
  onStage?: (stage: string, message: string, totalSegments: number, segmentIndex?: number) => void;
  /** 非致命警告（如连接异常结束但已收到部分内容） */
  onWarning?: (message: string) => void;
}

// P0：流式响应空闲超时（毫秒）——超过此时长未收到任何消息（含心跳）则判定连接异常
const STREAM_IDLE_TIMEOUT_MS = 90000;

export class SSEClient {
  private eventSource: EventSource | null = null;
  private url: string;
  private options: SSEClientOptions;
  private accumulatedContent: string = '';

  constructor(url: string, options: SSEClientOptions = {}) {
    this.url = url;
    this.options = options;
  }

  connect(): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        this.eventSource = new EventSource(this.url);

        this.eventSource.onmessage = (event) => {
          try {
            const message: SSEMessage = JSON.parse(event.data);
            this.handleMessage(message, resolve, reject);
          } catch (error) {
            console.error('解析SSE消息失败:', error);
          }
        };

        this.eventSource.onerror = (error) => {
          console.error('SSE连接错误:', error);
          if (this.options.onConnectionError) {
            this.options.onConnectionError(error);
          }
          this.close();
          reject(new Error('SSE连接失败'));
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(message: SSEMessage, resolve: (value: any) => void, reject: (reason?: any) => void) {
    switch (message.type) {
      case 'progress':
        if (this.options.onProgress && message.progress !== undefined) {
          this.options.onProgress(
            message.message || '',
            message.progress,
            message.status || 'processing',
            message.word_count
          );
        }
        break;

      case 'stage':
        if (this.options.onStage) {
          this.options.onStage(
            message.stage || '',
            message.message || '',
            message.total_segments || 0,
            message.segment_index
          );
        }
        break;

      case 'chunk':
        if (message.content) {
          this.accumulatedContent += message.content;
          if (this.options.onChunk) {
            this.options.onChunk(message.content, message.segment_index);
          }
        }
        break;

      case 'result':
        if (this.options.onResult && message.data) {
          this.options.onResult(message.data);
        }
        break;

      case 'error':
        if (this.options.onError) {
          this.options.onError(message.error || '未知错误', message.code);
        }
        this.close();
        reject(new Error(message.error || '未知错误'));
        break;

      case 'done':
        if (this.options.onComplete) {
          this.options.onComplete();
        }
        this.close();
        if (!this.options.onResult && this.accumulatedContent) {
          resolve({ content: this.accumulatedContent });
        } else {
          resolve(true);
        }
        break;
    }
  }

  close() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }
}

export class SSEPostClient {
  private url: string;
  private data: any;
  private options: SSEClientOptions;
  private abortController: AbortController | null = null;
  private accumulatedContent: string = '';
  private resultData: any = null;
  // P0：空闲超时定时器与完成标记
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private receivedDone: boolean = false;
  private settled: boolean = false;

  constructor(url: string, data: any, options: SSEClientOptions = {}) {
    this.url = url;
    this.data = data;
    this.options = options;
  }

  async connect(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.connectInternal(resolve, reject);
    });
  }

  private async connectInternal(resolve: (value: any) => void, reject: (reason?: any) => void) {
      try {
        this.abortController = new AbortController();

        const response = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(this.data),
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          // P0：尝试从错误响应体中提取后端可读错误信息，而非只显示状态码
          let detail = '';
          try {
            const errText = await response.text();
            const parsed = JSON.parse(errText);
            if (typeof parsed?.detail === 'string') {
              detail = parsed.detail;
            } else if (parsed?.detail && typeof parsed.detail === 'object' && typeof parsed.detail.message === 'string') {
              detail = parsed.detail.message;
            } else if (typeof parsed?.message === 'string') {
              detail = parsed.message;
            }
          } catch {
            // 非 JSON 错误体，忽略
          }
          throw new Error(detail || `请求失败（HTTP ${response.status}）`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('无法获取响应流');
        }

        // P0：启动空闲超时保护（收到任何数据都会重置）
        this.resetIdleTimer(reject);

        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // 收到数据，重置空闲超时
          this.resetIdleTimer(reject);

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim() === '' || line.startsWith(':')) {
              continue;
            }

            try {
              // P0：支持 SSE 多行 data 字段拼接（规范允许单条消息多个 data: 行）
              const dataLines = line
                .split('\n')
                .filter(l => l.startsWith('data:'))
                .map(l => l.slice(5).trim());
              if (dataLines.length === 0) continue;
              let data: any;
              try {
                data = JSON.parse(dataLines.join('\n'));
              } catch {
                data = JSON.parse(dataLines[0]);
              }

              // 标准消息处理
              const message: SSEMessage = data;
              await this.handleMessage(message, resolve, reject);
            } catch (error) {
              console.error('解析SSE消息失败:', error, line);
            }
          }
        }

        // P0：流结束但未收到 done 信号——不再静默挂起，按已收到的内容兜底处理
        this.clearIdleTimer();
        if (!this.receivedDone && !this.settled) {
          this.settled = true;
          if (this.resultData) {
            if (this.options.onWarning) {
              this.options.onWarning('连接已结束但未收到完成信号，已返回收到的结果');
            }
            resolve(this.resultData);
          } else if (this.accumulatedContent) {
            if (this.options.onWarning) {
              this.options.onWarning('连接已结束但未收到完成信号，已返回收到的内容，建议检查章节是否完整');
            }
            resolve({ content: this.accumulatedContent });
          } else {
            const msg = '连接已结束但未收到任何内容，请重试';
            if (this.options.onError) {
              this.options.onError(msg);
            }
            reject(new Error(msg));
          }
        }

      } catch (error: any) {
        this.clearIdleTimer();
        if (error.name === 'AbortError') {
          console.log('请求已取消');
        } else {
          console.error('SSE POST请求失败:', error);
          if (!this.settled) {
            this.settled = true;
            if (this.options.onError) {
              this.options.onError(error.message || '请求失败');
            }
            reject(error);
          }
        }
      }
  }

  /** P0：重置空闲超时定时器；超时后主动中断并报错，避免永久转圈 */
  private resetIdleTimer(reject: (reason?: any) => void) {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.receivedDone || this.settled) return;
      this.settled = true;
      const msg = `AI 响应超时（${STREAM_IDLE_TIMEOUT_MS / 1000} 秒未收到数据），连接已中断，请重试`;
      console.error(msg);
      if (this.options.onError) {
        this.options.onError(msg);
      }
      if (this.abortController) {
        this.abortController.abort();
      }
      reject(new Error(msg));
    }, STREAM_IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async handleMessage(message: SSEMessage, resolve: (value: any) => void, reject: (reason?: any) => void) {
    switch (message.type) {
      case 'progress':
        if (this.options.onProgress && message.progress !== undefined) {
          this.options.onProgress(
            message.message || '',
            message.progress,
            message.status || 'processing',
            message.word_count
          );
        }
        break;

      case 'stage':
        if (this.options.onStage) {
          this.options.onStage(
            message.stage || '',
            message.message || '',
            message.total_segments || 0,
            message.segment_index
          );
        }
        break;

      case 'chunk':
        if (message.content) {
          this.accumulatedContent += message.content;
          if (this.options.onChunk) {
            this.options.onChunk(message.content, message.segment_index);
          }
        }
        break;

      case 'result':
        if (this.options.onResult && message.data) {
          this.options.onResult(message.data);
        }
        this.resultData = message.data;
        break;

      case 'error':
        if (this.options.onError) {
          this.options.onError(message.error || '未知错误', message.code);
        }
        if (!this.settled) {
          this.settled = true;
          reject(new Error(message.error || '未知错误'));
        }
        break;

      case 'done':
        this.receivedDone = true;
        this.clearIdleTimer();
        if (this.options.onComplete) {
          this.options.onComplete();
        }
        if (!this.settled) {
          this.settled = true;
          if (this.resultData) {
            resolve(this.resultData);
          } else if (this.accumulatedContent) {
            resolve({ content: this.accumulatedContent });
          } else {
            resolve(true);
          }
        }
        break;
    }
  }

  abort() {
    this.clearIdleTimer();
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }
}

export async function ssePost<T = any>(
  url: string,
  data: any,
  options: SSEClientOptions = {}
): Promise<T> {
  const client = new SSEPostClient(url, data, options);
  try {
    return await client.connect();
  } finally {
    client.abort();
  }
}