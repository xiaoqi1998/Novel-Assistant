import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, List, Button, Space, Badge, Tag, Progress, Popconfirm, Empty, theme, Tooltip, message, notification } from 'antd';
import {
  ClockCircleOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  DeleteOutlined,
  UpOutlined,
  DownOutlined,
  ClearOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import { getProjectTasks, cancelTask, cancelBatchTask, deleteTask, clearProjectTasks, type TaskStatus } from '../services/backgroundTaskService';
import { eventBus } from '../store/eventBus';
import useIsMobile from '../utils/useIsMobile';

const COLLAPSED_KEY = 'mobinovel_task_panel_collapsed';
const POSITION_KEY = 'mobinovel_task_panel_position';
// 拖拽位移阈值（像素），超过该值才视为拖拽，避免与点击冲突
const DRAG_THRESHOLD = 4;

interface FloatingTaskPanelProps {
  projectId: string;
  autoRefreshInterval?: number; // 自动刷新间隔（毫秒），默认3000
}

interface PanelPosition {
  x: number;
  y: number;
}

/** 读取持久化的收起状态 */
const loadCollapsed = (): boolean => {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // ignore
  }
  return true;
};

/** 读取持久化的位置，并做基本视口裁剪，防止面板被丢到屏幕外 */
const loadPosition = (): PanelPosition | null => {
  try {
    const stored = localStorage.getItem(POSITION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        const x = Math.max(0, Math.min(parsed.x, window.innerWidth - 100));
        const y = Math.max(0, Math.min(parsed.y, window.innerHeight - 100));
        return { x, y };
      }
    }
  } catch {
    // ignore
  }
  return null;
};

/**
 * 悬浮任务框组件
 * 显示在页面右下角，支持收起/展开、拖拽移动，并在 Drawer 打开时自动隐藏
 */
export const FloatingTaskPanel: React.FC<FloatingTaskPanelProps> = ({
  projectId,
  autoRefreshInterval = 3000,
}) => {
  const [taskList, setTaskList] = useState<TaskStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed);
  const [position, setPosition] = useState<PanelPosition | null>(loadPosition);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const userCollapsedRef = useRef<boolean>(collapsed); // 用户手动收起标记，初始化与持久化状态一致
  const draggingRef = useRef(false); // 拖拽进行中标记，用于区分拖拽与点击
  const containerRef = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // 刚完成的任务 ID 集合（5 秒内醒目高亮，过后淡化）
  const [recentlyCompletedIds, setRecentlyCompletedIds] = useState<Set<string>>(new Set());
  // 前一次任务状态快照，用于检测 running/pending → completed 的转换
  const prevTaskStatusRef = useRef<Map<string, string>>(new Map());
  // 最新的任务列表引用，供 setTimeout 回调读取最新状态
  const taskListRef = useRef<TaskStatus[]>([]);
  taskListRef.current = taskList;
  // 清理任务记录的延迟定时器（用于撤销机制）
  const clearTimerRef = useRef<number | null>(null);
  const CLEAR_UNDO_KEY = 'task-clear-undo';

  // 持久化收起/展开状态
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  // 检测 Drawer 开关状态：监听 eventBus 事件 + DOM 检测（兼容任意 antd Drawer）
  useEffect(() => {
    const checkDrawer = () => {
      const open =
        document.body.classList.contains('ant-drawer-open') ||
        !!document.querySelector('.ant-drawer-open');
      setDrawerOpen(open);
    };

    checkDrawer();

    // 使用 rAF 节流，避免频繁 DOM 变更触发过多检查
    let rafId: number | null = null;
    const scheduleCheck = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        checkDrawer();
      });
    };

    const observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    });

    const handleDrawerOpen = () => setDrawerOpen(true);
    const handleDrawerClose = () => setDrawerOpen(false);
    eventBus.on('drawer:open', handleDrawerOpen);
    eventBus.on('drawer:close', handleDrawerClose);

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      eventBus.off('drawer:open', handleDrawerOpen);
      eventBus.off('drawer:close', handleDrawerClose);
    };
  }, []);

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const result = await getProjectTasks(projectId);
      setTaskList(result.items || []);
    } catch (error) {
      console.error('加载任务列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // 初始加载
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // 组件卸载时清理待执行的清理定时器与撤销通知
  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      notification.destroy(CLEAR_UNDO_KEY);
    };
  }, []);

  // 监听后台任务创建事件，立即刷新列表并展开浮窗
  useEffect(() => {
    const handleTaskCreated = () => {
      loadTasks();
      // 创建新任务时自动展开（重置用户手动收起标记）
      userCollapsedRef.current = false;
      setCollapsed(false);
    };
    eventBus.on('background-task-created', handleTaskCreated);
    return () => {
      eventBus.off('background-task-created', handleTaskCreated);
    };
  }, [loadTasks]);

  // 有活跃任务时自动展开（仅当用户没有手动收起时）
  useEffect(() => {
    const hasActiveTasks = taskList.some(
      (t) => t.status === 'running' || t.status === 'pending'
    );
    if (hasActiveTasks && !userCollapsedRef.current) {
      setCollapsed(false);
    }
  }, [taskList]);

  // 自动刷新（仅当有运行中或等待中的任务时）
  useEffect(() => {
    const hasActiveTasks = taskList.some(
      (t) => t.status === 'running' || t.status === 'pending'
    );

    if (!hasActiveTasks) return;

    const timer = setInterval(loadTasks, autoRefreshInterval);
    return () => clearInterval(timer);
  }, [taskList, autoRefreshInterval, loadTasks]);

  // 检测任务状态变化：running/pending → completed 时高亮 5 秒，过后淡化并自动收起面板
  useEffect(() => {
    const prevStatuses = prevTaskStatusRef.current;
    const newCompletions: string[] = [];

    taskList.forEach((task) => {
      const prevStatus = prevStatuses.get(task.id);
      if (
        task.status === 'completed' &&
        prevStatus &&
        (prevStatus === 'running' || prevStatus === 'pending')
      ) {
        newCompletions.push(task.id);
      }
    });

    // 更新前一次状态快照
    taskList.forEach((task) => {
      prevStatuses.set(task.id, task.status);
    });

    if (newCompletions.length === 0) return;

    // 标记为"刚完成"，应用醒目样式
    setRecentlyCompletedIds((prev) => {
      const next = new Set(prev);
      newCompletions.forEach((id) => next.add(id));
      return next;
    });

    // 5 秒后：移除醒目标记，并在无活跃任务时自动收起面板
    const timer = setTimeout(() => {
      setRecentlyCompletedIds((prev) => {
        const next = new Set(prev);
        newCompletions.forEach((id) => next.delete(id));
        return next;
      });
      const hasActive = taskListRef.current.some(
        (t) => t.status === 'running' || t.status === 'pending'
      );
      if (!hasActive) {
        setCollapsed(true);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [taskList]);

  // 取消任务
  const handleCancelTask = async (task: TaskStatus) => {
    try {
      if (task.task_type === 'chapter_batch') {
        await cancelBatchTask(task.id);
      } else {
        await cancelTask(task.id);
      }
      loadTasks();
    } catch (error) {
      console.error('取消任务失败:', error);
    }
  };

  // 删除任务记录
  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      loadTasks();
    } catch (error) {
      console.error('删除任务记录失败:', error);
    }
  };

  // 一键清理已结束的任务记录（带 5 秒撤销窗口）
  const handleClearTasks = async () => {
    // 若已有待执行的清理，先取消（用户重复点击）
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    // 统计即将清理的记录数，用于通知文案
    const endedTasks = taskListRef.current.filter(
      (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
    );
    const pendingCount = endedTasks.length;

    const performClear = async () => {
      try {
        const result = await clearProjectTasks(projectId);
        message.success(`已清理 ${result.deleted_count} 条任务记录`);
        loadTasks();
      } catch (error) {
        console.error('清理任务记录失败:', error);
        message.error('清理任务记录失败');
      } finally {
        clearTimerRef.current = null;
        notification.destroy(CLEAR_UNDO_KEY);
      }
    };

    const undoClear = () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      notification.destroy(CLEAR_UNDO_KEY);
      message.info('已撤销清理操作');
    };

    // 立即弹出撤销通知，5 秒后真正执行删除
    notification.open({
      key: CLEAR_UNDO_KEY,
      message: `即将清理 ${pendingCount} 条任务记录`,
      description: '5 秒后自动执行，点击撤销可取消本次操作。',
      type: 'info',
      duration: 0,
      btn: (
        <Button size="small" onClick={undoClear}>
          撤销
        </Button>
      ),
    });

    clearTimerRef.current = window.setTimeout(() => {
      void performClear();
    }, 5000);
  };

  // 拖拽：使用原生 mousedown/mousemove/mouseup 实现，拖拽手柄位于标题区左侧
  const handleDragStart = (e: React.MouseEvent) => {
    // 仅响应鼠标左键
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();

    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    const panelWidth = rect.width;
    const panelHeight = rect.height;

    let moved = false;
    let latestX = startLeft;
    let latestY = startTop;

    const handleMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        draggingRef.current = true;
        setIsDragging(true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }

      // 限制拖拽范围在视口内
      let newX = startLeft + dx;
      let newY = startTop + dy;
      newX = Math.max(0, Math.min(newX, window.innerWidth - panelWidth));
      newY = Math.max(0, Math.min(newY, window.innerHeight - panelHeight));
      latestX = newX;
      latestY = newY;
      setPosition({ x: newX, y: newY });
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (moved) {
        // 松手时保存位置到 localStorage
        try {
          localStorage.setItem(POSITION_KEY, JSON.stringify({ x: latestX, y: latestY }));
        } catch {
          // ignore
        }
      }
      setIsDragging(false);
      // 延迟重置拖拽标记，确保 click 事件能据此判断是否为拖拽尾随的点击
      setTimeout(() => {
        draggingRef.current = false;
      }, 0);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // 获取任务状态标签
  const getTaskStatusTag = (status: TaskStatus['status']) => {
    switch (status) {
      case 'pending':
        return <Tag icon={<ClockCircleOutlined />} color="default">等待中</Tag>;
      case 'running':
        return <Tag icon={<LoadingOutlined />} color="processing">运行中</Tag>;
      case 'completed':
        return <Tag icon={<CheckCircleOutlined />} color="success">已完成</Tag>;
      case 'failed':
        return <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>;
      case 'cancelled':
        return <Tag icon={<CloseCircleOutlined />} color="default">已取消</Tag>;
      default:
        return <Tag>{status}</Tag>;
    }
  };

  // 获取任务类型标签
  const getTaskTypeLabel = (taskType: string) => {
    switch (taskType) {
      case 'outline_new':
        return '大纲生成';
      case 'outline_continue':
        return '大纲续写';
      case 'outline_expand':
        return '大纲展开';
      case 'outline_batch_expand':
        return '批量大纲展开';
      case 'chapter_generate':
        return '章节生成';
      case 'chapter_batch':
        return '批量章节生成';
      case 'wizard':
        return '向导创建';
      case 'full_review':
        return '全文审查';
      default:
        return taskType;
    }
  };

  // 根据任务类型获取跳转路由
  const getTaskRoute = (task: TaskStatus): string => {
    // 优先使用组件已知的 projectId，避免后端数据缺失导致 undefined
    const pid = task.project_id || projectId;
    const base = `/project/${pid}`;
    switch (task.task_type) {
      case 'full_review':
        return `${base}/full-review`;
      case 'chapter_generate':
      case 'chapter_batch':
        return `${base}/chapters`;
      case 'outline_new':
      case 'outline_continue':
      case 'outline_expand':
      case 'outline_batch_expand':
        return `${base}/outline`;
      case 'wizard':
        return base;
      default:
        return base;
    }
  };

  // 点击完成任务跳转到对应页面
  const handleCompletedTaskClick = (task: TaskStatus) => {
    if (task.status === 'completed') {
      navigate(getTaskRoute(task));
    }
  };

  const activeTasks = taskList.filter((t) => t.status === 'running' || t.status === 'pending');
  const hasActiveTasks = activeTasks.length > 0;

  // 没有任务时不显示浮窗
  if (taskList.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        // 拖拽后使用 top/left 定位，未拖拽时使用默认的 bottom/right
        ...(position ? { top: position.y, left: position.x } : { bottom: 10, right: 23 }),
        width: collapsed ? Math.min(260, window.innerWidth - 32) : (isMobile ? Math.min(400, window.innerWidth - 32) : 400),
        maxHeight: collapsed ? 60 : 500,
        zIndex: 1000,
        boxShadow: token.boxShadowSecondary,
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
        // 拖拽时禁用过渡，避免面板滞后跟随；Drawer 打开时淡出隐藏
        transition: isDragging ? 'none' : 'all 0.3s ease',
        opacity: drawerOpen ? 0 : 1,
        pointerEvents: drawerOpen ? 'none' : 'auto',
      }}
    >
      <Card
        size="small"
        title={
          <Space
            onMouseDown={handleDragStart}
            style={{ cursor: 'grab', userSelect: 'none' }}
          >
            <Tooltip title="拖拽移动" mouseEnterDelay={0.5}>
              <HolderOutlined aria-hidden="true" />
            </Tooltip>
            <ClockCircleOutlined aria-hidden="true" />
            <span>后台任务</span>
            {hasActiveTasks && <Badge count={activeTasks.length} />}
          </Space>
        }
        extra={
          <Space>
            <Tooltip title="刷新">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={loadTasks}
                loading={loading}
                aria-label="刷新任务列表"
              />
            </Tooltip>
            {taskList.some(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') && (
              <Popconfirm
                title="确认清理所有已结束的任务记录？"
                onConfirm={handleClearTasks}
                okText="确认"
                cancelText="取消"
              >
                <Tooltip title="清理已结束任务">
                  <Button
                    type="text"
                    size="small"
                    icon={<ClearOutlined />}
                    aria-label="清理已结束任务"
                  />
                </Tooltip>
              </Popconfirm>
            )}
            <Button
              type="text"
              size="small"
              icon={collapsed ? <UpOutlined /> : <DownOutlined />}
              onClick={() => {
                // 拖拽刚结束时不响应点击，避免误触收起
                if (draggingRef.current) return;
                const newCollapsed = !collapsed;
                setCollapsed(newCollapsed);
                // 记录用户手动收起，防止自动展开覆盖
                userCollapsedRef.current = newCollapsed;
              }}
              aria-label={collapsed ? '展开任务面板' : '收起任务面板'}
            />
          </Space>
        }
        bodyStyle={{
          padding: collapsed ? 0 : 12,
          maxHeight: collapsed ? 0 : 400,
          overflowY: 'auto',
          transition: 'all 0.3s ease',
        }}
      >
        {!collapsed && (
          <>
            {taskList.length === 0 ? (
              <Empty description="暂无任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List
                size="small"
                dataSource={taskList}
                renderItem={(task: TaskStatus) => (
                  <List.Item
                    key={task.id}
                    style={{
                      padding: '8px 12px',
                      margin: '0 -12px',
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: 6,
                      transition: 'background 0.3s ease',
                      ...(recentlyCompletedIds.has(task.id) && {
                        background: token.colorSuccessBg,
                      }),
                      ...(task.status === 'completed' && {
                        cursor: 'pointer',
                      }),
                    }}
                    onClick={task.status === 'completed' ? () => handleCompletedTaskClick(task) : undefined}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ marginBottom: 4 }}>
                        <Space size={4} wrap>
                          {getTaskStatusTag(task.status)}
                          <Tag color="blue">{getTaskTypeLabel(task.task_type)}</Tag>
                          {recentlyCompletedIds.has(task.id) && (
                            <Tag color="success" icon={<CheckCircleOutlined />} style={{ fontWeight: 600 }}>
                              刚完成
                            </Tag>
                          )}
                          {task.status === 'completed' && (
                            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                              点击查看 →
                            </span>
                          )}
                        </Space>
                      </div>

                      {task.status_message && (
                        <div
                          style={{
                            fontSize: 12,
                            color: token.colorTextSecondary,
                            marginBottom: 4,
                          }}
                        >
                          {task.status_message}
                        </div>
                      )}

                      {(task.status === 'running' || task.status === 'pending') && (
                        <Progress
                          percent={task.progress}
                          size="small"
                          status={task.status === 'running' ? 'active' : 'normal'}
                          style={{ marginBottom: 4 }}
                        />
                      )}

                      {task.error_message && (
                        <div
                          style={{
                            fontSize: 12,
                            color: token.colorError,
                            marginBottom: 4,
                          }}
                        >
                          错误: {task.error_message}
                        </div>
                      )}

                      <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                        <Space size={4}>
                          {(task.status === 'running' || task.status === 'pending') && (
                            <Popconfirm
                              title="确认取消任务？"
                              onConfirm={() => handleCancelTask(task)}
                              okText="确认"
                              cancelText="取消"
                            >
                              <Button size="small" danger>
                                取消
                              </Button>
                            </Popconfirm>
                          )}
                          {task.status === 'completed' && (
                            <Button
                              size="small"
                              type="link"
                              onClick={() => handleCompletedTaskClick(task)}
                            >
                              查看结果
                            </Button>
                          )}
                          {(task.status === 'completed' ||
                            task.status === 'failed' ||
                            task.status === 'cancelled') && (
                              <Popconfirm
                                title="确认删除任务记录？"
                                onConfirm={() => handleDeleteTask(task.id)}
                                okText="确认"
                                cancelText="取消"
                              >
                                <Button size="small" icon={<DeleteOutlined />}>
                                  删除
                                </Button>
                              </Popconfirm>
                            )}
                        </Space>
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default FloatingTaskPanel;
