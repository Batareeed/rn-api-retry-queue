type RefreshValues = {}

abstract class ApiRetryQueue<V extends RefreshValues, RequestConfig, Response> {
  private isRefreshing: boolean = false

  private failedQueue: {
    resolve: (values: V) => void
    reject: (reason?: any) => void
  }[] = []

  private processQueue = (error?: any, values?: V) => {
    this.failedQueue.forEach((prom) => {
      if (error) prom.reject(error)
      else if (!values) prom.reject(new Error('Queue processing failed'))
      else prom.resolve(values)
    })
    this.failedQueue = []
  }

  /**
   * returns a tag to identify the current queue
   */
  abstract getTag(): string

  private getStatusProperty = (): string => `_retry${this.getTag()}`
  isRetry = (requestConfig: any): boolean =>
    !!requestConfig[this.getStatusProperty()]

  /**
   * Checks if an error should trigger a new request with updated parameters
   * @param error - the error thrown as a result of the request
   */
  abstract isApplicable(error: any): boolean

  /**
   * Will be called if the updated values for the next attempt have been received.
   * Should prepare the request config for the next attempt
   * @param request - the initial request config
   * @param values - updated values
   */
  abstract applyNewValues(request: RequestConfig, values: V): Promise<Response>

  /**
   * Should request the new values to be applied during the next attempt
   * will await for either onSuccess or onError to be called
   * @param onSuccess accepts the updated values
   * @param onError accepts the error in case of a failure
   */
  abstract refreshAction(
    onSuccess: (values: V) => void,
    onError: (error: any) => void,
  ): void

  /**
   * Starts the process of updating and retrying a failed request
   * @param error - the error thrown as a result of the request
   */
  public onError = (error: any): Promise<Response> => {
    const originalRequest = error.config

    if (this.isApplicable(error)) {
      if (this.isRefreshing) {
        return new Promise((resolve, reject) => {
          this.failedQueue.push({ resolve, reject })
        })
          .then((values: unknown) => {
            return this.applyNewValues(originalRequest, values as V)
          })
          .catch((err) => {
            return Promise.reject(err)
          })
      }

      originalRequest[this.getStatusProperty()] = true
      this.isRefreshing = true

      return new Promise((resolve, reject) => {
        this.refreshAction(
          (values: V) => {
            resolve(this.applyNewValues(originalRequest, values))
            this.processQueue(undefined, values)
            this.isRefreshing = false
          },
          (err: string) => {
            this.processQueue(err)
            reject(err)
            this.isRefreshing = false
          },
        )
      })
    }

    return Promise.reject(error)
  }
}

export default ApiRetryQueue
