import { BroadcastMessagePayload, Tables } from '@periskope/types';
import axios from 'axios';
import dayjs from 'dayjs';
import { QueryResult } from 'pg';
import BroadcastCompletedEmail from '../../../shared/emails/templates/broadcast-emails/broadcast-completed-email';
import BroadcastStartedEmail from '../../../shared/emails/templates/broadcast-emails/broadcast-started-email';
import { BaseHandler } from '../../../shared/handlers/base.handler';
import { CommunicationHandler } from '../../../shared/handlers/communication.handler';
import { pg_execute, supabaseAdmin } from '../../../shared/helpers/db';
import { logger } from '../../../shared/helpers/logger';
import { SlackWebhook } from '../../../shared/helpers/slack';
import { QueueNames } from '../../../shared/types/shared.types';
import { BroadcastCreditHandler } from './broadcast.credit.handler';
import { BroadcastEmailsHandler } from './broadcast.emails.handler';
import { EventHandler, QueueTypes } from '../event.handler';

type BroadcastMessageInfoQueueTypes = QueueTypes<
  Tables<'tbl_broadcast_messages'>,
  void,
  QueueNames.broadcastMessageInfo
>;

type BroadcastProgressQueueTypes = QueueTypes<
  Tables<'tbl_broadcast_messages'>,
  void,
  QueueNames.broadcastProgress
>;
export class BroadcastMessageHandler extends BaseHandler {
  broadcastMessageInfoQueue: BroadcastMessageInfoQueueTypes['Queue'];
  broadcastProgressQueue: BroadcastProgressQueueTypes['Queue'];
  private static _instance: BroadcastMessageHandler;
  private slack: SlackWebhook;
  private creditHandler: BroadcastCreditHandler;

  constructor() {
    super();
    this.slack = new SlackWebhook();
    this.broadcastMessageInfoQueue = new EventHandler(
      QueueNames.broadcastMessageInfo,
      this.processBroadcastMessageInfo.bind(this)
    );
    this.broadcastProgressQueue = new EventHandler(
      QueueNames.broadcastProgress,
      this.processBroadcastProgress.bind(this)
    );
    this.creditHandler = BroadcastCreditHandler.getInstance();
  }

  static getInstance() {
    if (this._instance) {
      return this._instance;
    }
    this._instance = new BroadcastMessageHandler();
    return this._instance;
  }

  logger(new_record?: Tables<'tbl_broadcast_messages'> | null) {
    return this.getLogger({
      org_id: new_record?.org_id,
      props: {
        broadcast_id: new_record?.broadcast_id,
      },
    });
  }

  //*-------------------------------------------------------------------------- //
  //*                            QUEUE OPERATIONS                               //
  //*-------------------------------------------------------------------------- //
  //                               HANDLER FUNCTIONS                            //
  // -------------------------------------------------------------------------- //

  /**
   * @function handleAddBroadcastMessageInfo
   *
   * @param new_record: BroadcastMessageInfoQueueTypes['Data'] :: Tables<'tbl_broadcast_messages'>
   *
   * @description Entry point for BroadcastMessageInfoQueue
   * Adds a new job to the queue every hour for 24 hours to
   * update the broadcast message delivery info
   *
   * @pointer processBroadcastMessageInfo
   **/

  @BaseHandler.tryCatchDecorator
  async handleAddBroadcastMessageInfo(
    new_record: BroadcastMessageInfoQueueTypes['Data']
  ) {
    await this.broadcastMessageInfoQueue.addJobToQueue(new_record, {
      jobId: `${new_record.org_id}-${new_record.broadcast_id}`,
      repeat: {
        every: 1000 * 60 * 60,
        immediately: true,
        limit: 24,
        jobId: `${new_record.org_id}-${new_record.broadcast_id}`,
      },
      repeatJobKey: `${new_record.org_id}-${new_record.broadcast_id}`,
    });
  }

  /**
   * @function handleAddBroadcastProgressJob
   * @param new_record: BroadcastMessageInfoQueueTypes['Data'] :: Tables<'tbl_broadcast_messages'>
   *
   * @description Entry point for BroadcastProgressQueue. Adds a new job to the queue
   * to update the broadcast progress to 'completed' or 'stopped'
   *
   *
   * @pointer processBroadcastProgress
   **/

  @BaseHandler.tryCatchDecorator
  async handleAddBroadcastProgressJob(
    new_record: BroadcastProgressQueueTypes['Data']
  ) {
    const existing_job = await this.broadcastProgressQueue.queue.getJob(
      `${new_record.org_id}-${new_record.broadcast_id}-progress`
    );

    if (existing_job) {
      await existing_job.remove();
    }

    await this.broadcastProgressQueue.addJobToQueue(
      new_record,
      {
        jobId: `${new_record.org_id}-${new_record.broadcast_id}-progress`,
        delay: 2000,
        removeOnComplete: true,
      },
      false
    );
  }

  //*-------------------------------------------------------------------------- //
  //*                               MAIN PROCESSORS                             //
  //*-------------------------------------------------------------------------- //

  // -------------------------------------------------------------------------- //
  //                          BROADCAST INFO PROCESSOR                          //
  // -------------------------------------------------------------------------- //

  /**
   * @param job: BroadcastMessageInfoQueueTypes['Job']
   *
   * @description Fetches logs from tbl_broadcast_logs and updates their delivery info.
   *
   * @pointer updateBroadcastInfo
   */

  @BaseHandler.tryCatchDecorator
  async processBroadcastMessageInfo(
    job: BroadcastMessageInfoQueueTypes['Job']
  ) {
    const isValid = await this.validateBroadcastMessageInfo(job.data);
    if (!isValid) {
      return;
    }

    const { broadcast_id, org_id } = job.data;

    const { data: broadcast } = await supabaseAdmin
      .from('tbl_broadcast_messages')
      .select('*')
      .eq('broadcast_id', broadcast_id)
      .eq('org_id', org_id)
      .maybeSingle();

    if (!broadcast) {
      this.logger(broadcast).error(
        new Error('Broadcast not found in processBroadcastMessageInfo') as any,
        {
          org_id,
          broadcast_id,
          queue: QueueNames.broadcastMessageInfo,
          slack: true,
          source: 'broadcast.handler > processBroadcastMessageInfo',
        }
      );

      await job.remove();
      return;
    }

    await this.updateBroadcastInfo(broadcast);

    this.logger(broadcast).info('Broadcast info updated', {
      queue: QueueNames.broadcastMessageInfo,
      source: 'broadcast.handler > processBroadcastMessageInfo',
    });
  }

  /**
   * @function processBroadcastProgress
   *
   * @param new_record: BroadcastMessageInfoQueueTypes['Data'] :: Tables<'tbl_broadcast_messages'>
   *
   * @description If the broadcast status is 'inprogress', the job is recursively added here until
   * updateBroadcastStatus returns 'completed' or 'failed'.
   *
   * @pointer updateBroadcastStatus
   **/

  @BaseHandler.tryCatchDecorator
  async processBroadcastProgress(job: BroadcastProgressQueueTypes['Job']) {
    const { data: broadcast } = job;

    const status = await this.updateBroadcastStatus({
      broadcast_id: broadcast.broadcast_id,
      org_id: broadcast.org_id,
    });

    this.logger(broadcast).info('Broadcast progress status update', {
      status,
      broadcast_id: broadcast.broadcast_id,
      source: 'broadcast.handler > processBroadcastProgress'
    });

    if (status === 'completed' || status === 'stopped') {
      const broadcastEmailsHandler = BroadcastEmailsHandler.getInstance();
      await broadcastEmailsHandler.handleBroadcastEmails({
        broadcast,
        email_type: `broadcast-${status}`,
        trace_id: broadcast.broadcast_id,
      });
      return; 
    }

    if (status === 'inprogress') {
      // Check for maximum retries
      const attempts = (job.attemptsMade || 0) + 1;
      if (attempts > 240) { // 2 hours maximum (30s * 240)
        await supabaseAdmin
          .from('tbl_broadcast_messages')
          .update({
            broadcast_status: 'expired',
          })
          .eq('broadcast_id', broadcast.broadcast_id)
          .eq('org_id', broadcast.org_id);
          
        this.logger(broadcast).warn('Broadcast expired due to max retries', {
          attempts,
          broadcast_id: broadcast.broadcast_id,
          source: 'broadcast.handler > processBroadcastProgress'
        });
        return;
      }

      // Backoff delay
      const delay = Math.min(30000 * Math.pow(1.1, attempts), 300000);

      await this.broadcastProgressQueue.addJobToQueue(
        broadcast,
        {
          jobId: `${broadcast.org_id}-${broadcast.broadcast_id}-progress-${Date.now()}`,
          delay,
          removeOnComplete: true,
          attempts: attempts
        },
        false
      );
    }
  }

  //*-------------------------------------------------------------------------- //
  //*                             BROADCAST ACTIONS                             //
  //*-------------------------------------------------------------------------- //

  // -------------------------------------------------------------------------- //
  //                             UPDATE BROADCAST INFO                          //
  // -------------------------------------------------------------------------- //

  /**
   * @function updateBroadcastInfo
   *
   * @param broadcast_id: string
   * @param org_id: string
   *
   * @description Fetches logs from tbl_broadcast_logs and phone numbers from tbl_org_phones
   * and sends a request to each phone server to fetch the message info for each chat_id.
   * The message info is then updated in tbl_broadcast_logs.
   *
   * @pointer processBroadcastMessageInfo
   **/
  @BaseHandler.tryCatchDecorator
  async updateBroadcastInfo({
    broadcast_id,
    org_id,
  }: {
    broadcast_id: string;
    org_id: string;
  }) {
    const { data: logs, error: logs_error } = await supabaseAdmin
      .from('tbl_broadcast_logs')
      .select('*')
      .eq('broadcast_id', broadcast_id)
      .eq('org_id', org_id)
      .not('message_id', 'is', null);

    if (logs_error || !logs) {
      this.logger().error(new Error(logs_error?.message) as any, {
        logs_error: {
          hint: logs_error?.hint,
          code: logs_error?.code,
        },
        broadcast_id,
        org_id,
        source: 'broadcast.handler > updateBroadcastInfo > logs_error',
      });
      return;
    }

    const { data: phones, error: phones_error } = await supabaseAdmin
      .from('tbl_org_phones')
      .select('*')
      .eq('org_id', org_id)
      .eq('is_ready', true);

    if (phones_error || !phones) {
      this.logger().error(new Error(phones_error?.message) as any, {
        phones_error: {
          hint: phones_error?.hint,
          code: phones_error?.code,
        },
        broadcast_id,
        org_id,
        source: 'broadcast.handler > updateBroadcastInfo > phones_error',
      });
      return;
    }

    const phone_server_map = phones.reduce(
      (acc, phone) => {
        const _cm = logs
          .filter((log) => log.org_phone === phone.org_phone)
          .map((log) => ({ message_id: log.message_id, chat_id: log.chat_id }));
        acc[phone.phone_id] = {
          server_ip: phone.server_ip,
          org_id: phone.org_id,
          chat_messages: _cm,
        };
        return acc;
      },
      {} as Record<
        string,
        {
          server_ip: string | null;
          org_id: string;
          chat_messages: { message_id: string | null; chat_id: string }[];
        }
      >
    );

    const requests = Object.entries(phone_server_map).map(
      ([phone_id, value]) => {
        const { server_ip, org_id, chat_messages } = value;

        return axios
          .request({
            url: `http://${server_ip}/v1/message/info`,
            method: 'POST',
            data: chat_messages,
            timeout: 60000,
            headers: {
              phone_id,
              org_id,
              role: 'service_role',
            },
          })
          .then((response) => {
            return response.data;
          })
          .catch((error: any) => {
            this.logger().error(error, {
              source: 'broadcast.handler > updateBroadcastInfo > requests',
            });
          });
      }
    );

    const broadcast_info = await Promise.allSettled(requests);
    const broadcast = await this.getBroadcastFromId({ broadcast_id, org_id });

    if (!broadcast) {
      this.logger(broadcast).error(
        new Error('Broadcast not found in updateBroadcastInfo') as any,
        {
          broadcast_id,
          org_id,
          source: 'broadcast.handler > updateBroadcastInfo > broadcast_error',
        }
      );
      return;
    }

    await this.updateBroadcastStatus({ broadcast_id, org_id });

    return broadcast_info;
  }

  // -------------------------------------------------------------------------- //
  //                             UPDATE BROADCAST STATUS                        //
  // -------------------------------------------------------------------------- //
  /**
   * @function updateBroadcastStatus
   *
   * @param broadcast: Tables<'tbl_broadcast_messages'>
   *
   * @description if the broadcast status is 'inprogress', the function checks if the broadcast
   * has been in progress for over 6 hours. If so, the broadcast status is updated to 'stopped'.
   * If no logs are present with is_success as null, the broadcast status is updated to 'completed'.
   *
   * @returns 'completed' | 'inprogress' | 'stopped'
   **/

  @BaseHandler.tryCatchDecorator
  async updateBroadcastStatus({
    broadcast_id,
    org_id,
  }: {
    broadcast_id: string;
    org_id: string;
  }) {
    const { data: current_broadcast } = await supabaseAdmin
      .from('tbl_broadcast_messages')
      .select('*')
      .eq('broadcast_id', broadcast_id)
      .eq('org_id', org_id)
      .maybeSingle();

    if (current_broadcast?.broadcast_status === 'stopped') {
      return 'stopped';
    }

    const { data: logs } = await supabaseAdmin
      .from('tbl_broadcast_logs')
      .select('*')
      .eq('broadcast_id', broadcast_id)
      .is('is_success', null)
      .eq('org_id', org_id);

    if (current_broadcast?.broadcast_status === 'inprogress') {
      if (!logs?.length) {
        // If no logs are present with null is_success, update broadcast status to completed
        await supabaseAdmin
          .from('tbl_broadcast_messages')
          .update({
            broadcast_status: 'completed',
          })
          .eq('broadcast_id', broadcast_id)
          .eq('org_id', org_id);

        return 'completed';
      }

      const { data: latest_message, error } = await supabaseAdmin
        .from('tbl_chat_messages')
        .select('*')
        .eq('org_id', org_id)
        .eq('broadcast_id', broadcast_id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      const is_latest_message_before_10_mins = latest_message
        ? dayjs().diff(dayjs(latest_message.timestamp), 'minute') > 10
        : true;

      if (
        dayjs().diff(dayjs(current_broadcast.performed_at), 'hour') > 6 &&
        is_latest_message_before_10_mins
      ) {
        // If an incomplete broadcast is present for over 6 hours, update broadcast status to stopped
        await supabaseAdmin
          .from('tbl_broadcast_messages')
          .update({
            broadcast_status: 'expired',
          })
          .eq('broadcast_id', broadcast_id)
          .eq('org_id', org_id);

        await supabaseAdmin
          .from('tbl_broadcast_logs')
          .update({
            is_success: false,
            remarks: 'Broadcast stopped by system',
          })
          .eq('broadcast_id', broadcast_id)
          .eq('org_id', org_id)
          .is('is_success', null);

        return 'expired';
      }
    }

    return 'inprogress';
  }

  // -------------------------------------------------------------------------- //
  //                            GET BROADCASTS BY ID                            //
  // -------------------------------------------------------------------------- //
  @BaseHandler.tryCatchDecorator
  async getBroadcastFromId({
    broadcast_id,
    org_id,
  }: {
    broadcast_id: string;
    org_id: string;
  }) {
    const { data: broadcast } = await supabaseAdmin
      .from('tbl_broadcast_messages')
      .select('*')
      .eq('broadcast_id', broadcast_id)
      .eq('org_id', org_id)
      .maybeSingle();

    return broadcast;
  }
  // -------------------------------------------------------------------------- //
  //                               SEND BROADCASTS                              //
  // -------------------------------------------------------------------------- //

  /**
   * @function sendBroadcasts
   *
   * @param broadcast: Tables<'tbl_broadcast_messages'>
   *
   * @description Fetches chat_ids from tbl_chats and tbl_org_phones and sends a request to each phone server
   * to send the broadcast message to the chat_ids. The logs are then updated in tbl_broadcast_logs.
   *
   * @pointer handleAddBroadcastMessageInfo
   * @pointer handleAddBroadcastProgressJob
   **/
  @BaseHandler.tryCatchDecorator
  async sendBroadcasts(broadcast: Tables<'tbl_broadcast_messages'>) {

    /**
     ** STEP: 0
     *  CHECK CREDITS
     **/

     const totalMessageCount = broadcast.chat_ids?.length || 0;
      const orgCredits = await this.creditHandler.checkCredits({
        org_id: broadcast.org_id,
        message_count: totalMessageCount,
      });
      
    /**
     ** STEP: 1
     *  INSERT BROADCAST LOGS WITH NULL IS_SUCCESS AND SEND EMAIL
     **/

    const [log_response, message_response] = await Promise.all([
      supabaseAdmin.from('tbl_broadcast_logs').upsert(
        (broadcast.chat_ids || []).map((chat_id) => ({
          chat_id,
          broadcast_id: broadcast.broadcast_id,
          is_success: null,
          org_id: broadcast.org_id,
        })),
        {
          onConflict: 'chat_id, broadcast_id, org_id',
          ignoreDuplicates: true,
        }
      ),

      /**
       ** STEP: 2
       *  UPDATE tbl_broadcast_messages with broadcast_status as 'inprogress' and performed_at as current time
       **/
      supabaseAdmin
        .from('tbl_broadcast_messages')
        .update({
          performed_at: new Date().toISOString(),
          broadcast_status: 'inprogress',
        })
        .eq('broadcast_id', broadcast.broadcast_id)
        .eq('org_id', broadcast.org_id)
        .select('*')
        .maybeSingle(),
    ]);

    if (log_response.error) {
      this.logger().error(new Error(log_response?.error?.message) as any, {
        logs_error: {
          hint: log_response?.error?.hint,
          code: log_response?.error?.code,
        },
        org_id: broadcast.org_id,
        broadcast_id: broadcast.broadcast_id,
        slack: true,
        source: 'broadcast.handler > sendBroadcasts > log_response',
      });
    }

    if (message_response.error || !message_response.data) {
      this.logger().error(new Error(message_response?.error?.message) as any, {
        logs_error: {
          hint: message_response?.error?.hint,
          code: message_response?.error?.code,
        },
        org_id: broadcast.org_id,
        broadcast_id: broadcast.broadcast_id,
        slack: true,
        source: 'broadcast.handler > sendBroadcasts > message_response',
      });
      return;
    }

    const broadcastEmailsHandler = BroadcastEmailsHandler.getInstance();
    await broadcastEmailsHandler.handleBroadcastEmails({
      broadcast,
      email_type: 'broadcast-started',
      trace_id: broadcast.broadcast_id,
    });

    /**
     ** STEP: 3
     *  FETCH RANKED CHATS FROM tbl_chats + tbl_org_phones
     **/
    let chats = {} as QueryResult<{
      phone_id: string;
      server_ip: string;
      org_id: string;
      chat_ids: string[];
    }>;
    let credits_distribution: Record<'topup' | 'recurring', number> = {
      topup: 0,
      recurring: 0,
    };
    let chatCreditMap: Record<string, 'recurring' | 'topup'> = {};

    try {
      chats = await pg_execute<{
        phone_id: string;
        server_ip: string;
        org_id: string;
        chat_ids: string[];
      }>(
        `WITH 
          ChatList AS (
            SELECT DISTINCT UNNEST($2::text[]) as chat_id
          ),
          SelectedPhone AS (
            SELECT 
              phone_id,
              server_ip,
              org_id,
              org_phone
            FROM tbl_org_phones 
            WHERE org_id = $1 
              AND is_ready = true
              ${broadcast.org_phone ? `AND org_phone = $3` : ''}
          ),
          RankedChats AS (
            SELECT 
              cl.chat_id,
              sp.phone_id,
              sp.server_ip,
              sp.org_id,
              ROW_NUMBER() OVER (PARTITION BY cl.chat_id ORDER BY 
                CASE 
                  WHEN ${broadcast.org_phone ? 'TRUE' : 'FALSE'} THEN 1
                  WHEN tc.org_phone = sp.org_phone THEN 2
                  ELSE 3
                END
              ) AS rn
            FROM ChatList cl
            CROSS JOIN SelectedPhone sp
            LEFT JOIN tbl_chats tc ON cl.chat_id = tc.chat_id AND tc.org_id = $1
          )
          SELECT 
            phone_id,
            server_ip,
            org_id,
            ARRAY_AGG(chat_id) AS chat_ids
          FROM RankedChats
          WHERE rn = 1
          GROUP BY phone_id, server_ip, org_id`,
          broadcast.org_phone
          ? [broadcast.org_id, broadcast.chat_ids, broadcast.org_phone]
          : [broadcast.org_id, broadcast.chat_ids]
      );


      if (!chats.rows?.length) {
        logger.error('Ranked Chats Failure', {
          broadcast_id: broadcast.broadcast_id,
          org_id: broadcast.org_id,
          chat_ids: broadcast.chat_ids,
          ranked_chats: chats,
          source: 'broadcast.handler > sendBroadcasts > chats',
        });
      }


      if (!chats.rows?.length) {
        logger.error('Ranked Chats Failure', {
          broadcast_id: broadcast.broadcast_id,
          org_id: broadcast.org_id,
          chat_ids: broadcast.chat_ids,
          ranked_chats: chats,
          source: 'broadcast.handler > sendBroadcasts > chats',
        });
      }
      

      if (orgCredits.recurring_balance < totalMessageCount) {
        const recurringChatIds = broadcast.chat_ids?.slice(0, orgCredits.recurring_balance) || [];
        const topupChatIds = broadcast.chat_ids?.slice(orgCredits.recurring_balance) || [];
        
        recurringChatIds.forEach(chatId => {
          chatCreditMap[chatId] = 'recurring';
        });
        topupChatIds.forEach(chatId => {
          chatCreditMap[chatId] = 'topup';
        });

        // if recurring balance is less than total message count, 
        // debit recurring balance first and then topup balance
        if (orgCredits.recurring_balance > 0) {
          await this.creditHandler.debitCredits({
            org_id: broadcast.org_id,
            message_count: orgCredits.recurring_balance,
            broadcast_id: broadcast.broadcast_id,
            from_topup: false,
          });
        }
        await this.creditHandler.debitCredits({
          org_id: broadcast.org_id,
          message_count: totalMessageCount - orgCredits.recurring_balance,
          broadcast_id: broadcast.broadcast_id,
          from_topup: true,
        });

        credits_distribution = {
          topup: totalMessageCount - orgCredits.recurring_balance,
          recurring: orgCredits.recurring_balance,
        };
      } else {
        // if recurring balance is more than total message count,
        // debit credits from recurring balance
        broadcast.chat_ids?.forEach(chatId => {
          chatCreditMap[chatId] = 'recurring';
        });

        await this.creditHandler.debitCredits({
          org_id: broadcast.org_id,
          message_count: totalMessageCount,
          broadcast_id: broadcast.broadcast_id,
          from_topup: false,
        });

        credits_distribution = {
          topup: 0,
          recurring: totalMessageCount,
        };
      }
    } catch (error: any) {
      this.logger(broadcast).error(error, {
        slack: true,
        broadcast_id: broadcast.broadcast_id,
        source: 'broadcast.handler > sendBroadcasts > chats',
      });

      // If there's an error after debiting credits, attempt to refund
      // if (broadcast.chat_ids?.length) {
      //   await this.creditHandler.refundCredits({
      //     org_id: broadcast.org_id,
      //     message_count: broadcast.chat_ids.length,
      //     broadcast_id: broadcast.broadcast_id,
      //   });
      // }
    }


    if (
      !broadcast.chat_ids ||
      chats.rows?.length !== broadcast.chat_ids?.length
    ) {
      const chat_id_map = chats.rows.map((r) => r.chat_ids).flat();
      // insert logs with is_success as false for invalid chat_ids from ranked chats
      const error_chat_ids =
        broadcast.chat_ids?.filter((c) => {
          return !chat_id_map.includes(c);
        }) ?? [];
      const { error: invalid_broadcast_error } = await supabaseAdmin
        .from('tbl_broadcast_logs')
        .upsert(
          error_chat_ids.map((chat_id) => ({
            chat_id,
            broadcast_id: broadcast.broadcast_id,
            org_id: broadcast.org_id,
            is_success: false,
            remarks: 'Chat does not exist for the phone',
          })),
          {
            onConflict: 'chat_id, broadcast_id, org_id',
            ignoreDuplicates: false,
          }
        );

      // Calculate refund amounts based on credit type
      const refundAmounts = error_chat_ids.reduce((acc, chatId) => {
        const creditType = chatCreditMap[chatId];
        acc[creditType] = (acc[creditType] || 0) + 1;
        return acc;
      }, {} as Record<'recurring' | 'topup', number>);

      await this.creditHandler.refundCredits({
        org_id: broadcast.org_id,
        broadcast_id: broadcast.broadcast_id,
        message_count: error_chat_ids.length,
        credits_distribution: {
          recurring: refundAmounts.recurring || 0,
          topup: refundAmounts.topup || 0
        }
      });

      if (invalid_broadcast_error) {
        logger.error(new Error(invalid_broadcast_error.message) as any, {
          error: {
            hint: invalid_broadcast_error?.hint,
            code: invalid_broadcast_error?.code,
          },
          org_id: broadcast.org_id,
          broadcast_id: broadcast.broadcast_id,
          source:
            'broadcast.handler > sendBroadcasts > invalid_broadcast_error',
        });
      }
    }

    /**
     ** STEP: 4
     *  SEND INDIVIDUAL BROADCAST REQUESTS TO WWEB-SERVER
     * */
    const requests = chats.rows.map(
      ({ phone_id, chat_ids, org_id, server_ip }) => {
        return axios
          .post<any, any, BroadcastMessagePayload>(
            `http://${server_ip}/v1/message/broadcast`,
            {
              ...broadcast.message_payload,
              broadcast_id: broadcast.broadcast_id,
              chat_ids,
              variables: (
                broadcast.variables as BroadcastMessagePayload['variables']
              )?.reduce(
                (acc, v) => {
                  acc[v.chat_id] = v.values;
                  return acc;
                },
                {} as Record<string, unknown>
              ),
            },
            {
              headers: {
                phone_id,
                org_id,
                role: 'service_role',
              },
            }
          )
          .then(response => response)
          .catch(async (e) => {
            // Calculate refund amounts for failed requests based on credit type
            const failedRefundAmounts = chat_ids.reduce((acc, chatId) => {
              const creditType = chatCreditMap[chatId];
              acc[creditType] = (acc[creditType] || 0) + 1;
              return acc;
            }, {} as Record<'recurring' | 'topup', number>);

            await this.creditHandler.refundCredits({
              org_id: broadcast.org_id,
              broadcast_id: broadcast.broadcast_id,
              message_count: chat_ids.length,
              credits_distribution: {
                recurring: failedRefundAmounts.recurring || 0,
                topup: failedRefundAmounts.topup || 0
              }
            });

            // if the request fails, insert the logs with is_success as false
            logger.error(e, {
              broadcast_id: broadcast.broadcast_id,
              org_id: broadcast.org_id,
              server_ip,
              slack: true,
              source: 'broadcast.handler > sendBroadcasts > requests',
            });
            let remarks = e.message;

            if (e.code === 'ECONNREFUSED') {
              remarks = 'Server is unreachable';
            }

            await supabaseAdmin.from('tbl_broadcast_logs').upsert(
              chat_ids.map((chat_id) => ({
                chat_id,
                broadcast_id: broadcast.broadcast_id,
                org_id: broadcast.org_id,
                is_success: false,
                remarks: remarks,
              })),
              {
                onConflict: 'chat_id, broadcast_id, org_id',
                ignoreDuplicates: false,
              }
            );

            return null;
          });
      }
    );

    try {
      await Promise.allSettled(requests);
    } catch (error: any) {
      this.logger(broadcast).error(error.message, {
        error: JSON.stringify(error),
        source: 'broadcast.handler > sendBroadcasts > requests',
        broadcast_id: broadcast.broadcast_id,
      });
    }

    // update messages info after sending request
    this.handleAddBroadcastMessageInfo({
      ...message_response.data,
      trace_id: broadcast.broadcast_id,
    });
    // add message progress job
    this.handleAddBroadcastProgressJob({
      ...message_response.data,
      trace_id: broadcast.broadcast_id,
    });
  }

  // -------------------------------------------------------------------------- //
  //                          VALIDATE BROADCAST INFO                           //
  // -------------------------------------------------------------------------- //

  @BaseHandler.tryCatchDecorator
  async validateBroadcastMessageInfo(
    new_record: Tables<'tbl_broadcast_messages'>
  ) {
    const { performed_at } = new_record;

    const isUnder24hours = dayjs().isBefore(
      dayjs(performed_at).add(25, 'hour'),
      'hour'
    );

    if (!isUnder24hours) {
      return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------- //
  //                             STOP BROADCAST                                 //
  // -------------------------------------------------------------------------- //
  /**
   * @function stopAndUpdateBroadcast
   *
   * @param broadcast_id: string
   * @param org_id: string
   *
   * @description purge the broadcast queue for each phone server
   *  - update the broadcast logs with is_success as false
   *  - update the broadcast status to 'stopped'
   *
   * @returns 'completed' | 'inprogress' | 'stopped'
   **/
  @BaseHandler.tryCatchDecorator
  async stopAndUpdateBroadcast({
    broadcast_id,
    org_id,
  }: {
    broadcast_id: string;
    org_id: string;
  }) {
    const { data: phones, error: phones_error } = await supabaseAdmin
      .from('tbl_org_phones')
      .select('*')
      .eq('org_id', org_id)
      .eq('is_ready', true);

    if (phones_error || !phones) {
      this.logger().error(new Error(phones_error?.message) as any, {
        phones_error: {
          hint: phones_error?.hint,
          code: phones_error?.code,
        },
        broadcast_id,
        org_id,
        source: 'broadcast.handler > stopAndUpdateBroadcast > phones_error',
      });
      return;
    }

    // Get count of unsent messages
    const { count } = await supabaseAdmin
      .from('tbl_broadcast_logs')
      .select('*', { count: 'exact', head: true })
      .eq('broadcast_id', broadcast_id)
      .eq('org_id', org_id)
      .is('is_success', null);

    const unsentCount = count || 0;

    // Prepare the requests to stop the broadcasts
    const requests = phones.map((phone) => {
      return axios.request({
        method: 'POST',
        url: `http://${phone.server_ip}/v1/message/queue/purge`,
        headers: {
          phone_id: phone.phone_id,
          org_id,
          role: 'service_role',
        },
        data: {
          broadcast_id: broadcast_id,
        },
      });
    });

    const stopped_broadcast = await Promise.allSettled(requests);

    // Update broadcast_logs, set all logs with is_success as null to false
    const { error: logError } = await supabaseAdmin
      .from('tbl_broadcast_logs')
      .update({ is_success: false, remarks: 'Broadcast stopped by user' })
      .eq('broadcast_id', broadcast_id)
      .eq('org_id', org_id)
      .is('is_success', null);

    if (logError) {
      this.logger().error(new Error(logError?.message) as any, {
        logError: {
          hint: logError?.hint,
          code: logError?.code,
        },
        broadcast_id,
        org_id,
        source: 'broadcast.handler > stopAndUpdateBroadcast > logError',
      });
    }

    // Update the broadcast messages status to stopped
    const { error: messagesError } = await supabaseAdmin
      .from('tbl_broadcast_messages')
      .update({
        broadcast_status: 'stopped',
      })
      .eq('broadcast_id', broadcast_id)
      .eq('org_id', org_id);

    if (messagesError) {
      this.logger().error(new Error(messagesError.message) as any, {
        messagesError: {
          hint: messagesError?.hint,
          code: messagesError?.code,
        },
        broadcast_id,
        org_id,
        source: 'broadcast.handler > stopAndUpdateBroadcast > messagesError',
      });
    }

    return true;
  }

  // -------------------------------------------------------------------------- //
  //                           CHECK SHEDULED BROADCASTS                         //
  // -------------------------------------------------------------------------- //

  @BaseHandler.tryCatchDecorator
  async checkForBroadcasts() {
    const { data, error } = await supabaseAdmin
      .from('tbl_broadcast_messages')
      .select('*')
      .is('performed_at', null)
      .is('broadcast_status', null);

    if (error) {
      this.logger().error(new Error(error.message) as any, {
        error: {
          hint: error?.hint,
          code: error?.code,
        },
        source: 'broadcast.handler > checkForBroadcasts',
      });
      return;
    }
    if (!data) {
      return;
    }
    const promises = [];

    for (const broadcast of data) {
      const isWithin1Hour = dayjs(
        // check if the broadcast is before and closer to the current time by 1 hour
        broadcast.scheduled_at || broadcast.created_at
      ).isAfter(dayjs().subtract(1, 'hour'));

      // check if the broadcast is after now
      const isAfterNow = broadcast.scheduled_at
        ? dayjs(broadcast?.scheduled_at).isAfter(dayjs())
        : false;

      if (!isWithin1Hour || isAfterNow) {
        continue;
      }

      promises.push(
        new Promise(async (res, rej) => {
          try {
            const response = await this.sendBroadcasts(broadcast);
            res({ response, broadcast, broadcast_id: broadcast.broadcast_id });
          } catch (e) {
            rej({ e, broadcast, brodacast_id: broadcast.broadcast_id });
          }
        })
      );
    }
    const response = await Promise.allSettled(promises);

    for (const r of response) {
      if (r.status === 'rejected') {
        this.logger().error(r?.reason?.e, {
          broadcast_id: r.reason?.broadcast_id,
          slack: true,
          source: 'broadcast.handler > checkForBroadcasts > response',
        });
        continue;
      }
    }
  }

}
