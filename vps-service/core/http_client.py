#!/usr/bin/env python3
"""
HTTP Client with Retry Logic
============================
عميل HTTP مع منطق إعادة المحاولة

Provides safe HTTP calls with automatic retry for:
- Connection errors
- Timeouts
- HTTP 5xx errors

Uses tenacity library for robust retry handling.

Author:M2yDevelopers Team
Version: 1.0.0
"""

import logging
from functools import wraps
from typing import Optional, Dict, Any, Union, Callable

import requests
from requests.exceptions import (
    ConnectionError,
    Timeout,
    HTTPError,
    RequestException
)
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
    after_log
)

# Configure logging
logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

MAX_RETRIES = 3
DEFAULT_TIMEOUT = 30
MIN_WAIT_SECONDS = 1
MAX_WAIT_SECONDS = 10

# Exceptions that trigger retry
RETRY_EXCEPTIONS = (
    ConnectionError,
    Timeout,
)


class HTTPServerError(Exception):
    """Raised when server returns 5xx error"""
    def __init__(self, status_code: int, message: str = ""):
        self.status_code = status_code
        self.message = message
        super().__init__(f"HTTP {status_code}: {message}")


def _should_retry_http_5xx(exception: BaseException) -> bool:
    """Check if exception is a 5xx HTTP error"""
    if isinstance(exception, HTTPServerError):
        return 500 <= exception.status_code < 600
    return False


# ============================================================================
# RETRY DECORATOR
# ============================================================================

retry_http = retry(
    stop=stop_after_attempt(MAX_RETRIES),
    wait=wait_exponential(
        multiplier=1,
        min=MIN_WAIT_SECONDS,
        max=MAX_WAIT_SECONDS
    ),
    retry=(
        retry_if_exception_type(RETRY_EXCEPTIONS) |
        retry_if_exception_type(HTTPServerError)
    ),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    after=after_log(logger, logging.INFO),
    reraise=True
)


# ============================================================================
# SAFE HTTP METHODS
# ============================================================================

def _make_request(
    method: str,
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    raise_for_status: bool = True,
    **kwargs
) -> requests.Response:
    """
    Internal method to make HTTP request with retry logic.

    Args:
        method: HTTP method (GET, POST, etc.)
        url: Request URL
        timeout: Request timeout in seconds
        raise_for_status: Whether to raise exception for HTTP errors
        **kwargs: Additional arguments passed to requests

    Returns:
        requests.Response object

    Raises:
        HTTPServerError: For 5xx errors (triggers retry)
        ConnectionError: For connection failures (triggers retry)
        Timeout: For timeout errors (triggers retry)
        RequestException: For other request errors
    """
    logger.debug(f"HTTP {method} request to {url}")

    response = requests.request(
        method=method.upper(),
        url=url,
        timeout=timeout,
        **kwargs
    )

    # Check for 5xx errors
    if 500 <= response.status_code < 600:
        logger.warning(f"Server error {response.status_code} for {url}")
        raise HTTPServerError(response.status_code, response.text[:200])

    # Raise for other HTTP errors if requested
    if raise_for_status:
        response.raise_for_status()

    return response


# Apply retry decorator
_safe_request = retry_http(_make_request)


def safe_get(
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    raise_for_status: bool = True,
    **kwargs
) -> requests.Response:
    """
    GET request with automatic retry.

    Retries on:
    - ConnectionError
    - Timeout
    - HTTP 5xx errors

    Args:
        url: Request URL
        timeout: Request timeout in seconds (default: 30)
        raise_for_status: Whether to raise exception for HTTP errors (default: True)
        **kwargs: Additional arguments passed to requests.get

    Returns:
        requests.Response object

    Example:
        >>> response = safe_get('https://api.example.com/data')
        >>> data = response.json()

    Raises:
        HTTPServerError: After all retries exhausted for 5xx errors
        ConnectionError: After all retries exhausted for connection errors
        Timeout: After all retries exhausted for timeout errors
    """
    return _safe_request('GET', url, timeout=timeout, 
                         raise_for_status=raise_for_status, **kwargs)


def safe_post(
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    raise_for_status: bool = True,
    **kwargs
) -> requests.Response:
    """
    POST request with automatic retry.

    Retries on:
    - ConnectionError
    - Timeout
    - HTTP 5xx errors

    Args:
        url: Request URL
        timeout: Request timeout in seconds (default: 30)
        raise_for_status: Whether to raise exception for HTTP errors (default: True)
        **kwargs: Additional arguments passed to requests.post

    Returns:
        requests.Response object

    Example:
        >>> response = safe_post('https://api.example.com/data', json={'key': 'value'})
        >>> data = response.json()

    Raises:
        HTTPServerError: After all retries exhausted for 5xx errors
        ConnectionError: After all retries exhausted for connection errors
        Timeout: After all retries exhausted for timeout errors
    """
    return _safe_request('POST', url, timeout=timeout,
                         raise_for_status=raise_for_status, **kwargs)


def safe_put(
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    raise_for_status: bool = True,
    **kwargs
) -> requests.Response:
    """
    PUT request with automatic retry.
    """
    return _safe_request('PUT', url, timeout=timeout,
                         raise_for_status=raise_for_status, **kwargs)


def safe_delete(
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    raise_for_status: bool = True,
    **kwargs
) -> requests.Response:
    """
    DELETE request with automatic retry.
    """
    return _safe_request('DELETE', url, timeout=timeout,
                         raise_for_status=raise_for_status, **kwargs)


# ============================================================================
# SAFE JSON HELPERS
# ============================================================================

def safe_get_json(
    url: str,
    timeout: int = DEFAULT_TIMEOUT,
    default: Any = None,
    **kwargs
) -> Optional[Any]:
    """
    GET request that returns parsed JSON with automatic retry.

    Args:
        url: Request URL
        timeout: Request timeout in seconds
        default: Default value to return on failure (default: None)
        **kwargs: Additional arguments passed to requests.get

    Returns:
        Parsed JSON data or default value on failure

    Example:
        >>> data = safe_get_json('https://api.example.com/data', default={})
        >>> print(data)
    """
    try:
        response = safe_get(url, timeout=timeout, **kwargs)
        return response.json()
    except RequestException as e:
        logger.error(f"Failed to fetch JSON from {url}: {e}")
        return default


def safe_post_json(
    url: str,
    json_data: Optional[Dict] = None,
    timeout: int = DEFAULT_TIMEOUT,
    default: Any = None,
    **kwargs
) -> Optional[Any]:
    """
    POST request that returns parsed JSON with automatic retry.

    Args:
        url: Request URL
        json_data: JSON body to send
        timeout: Request timeout in seconds
        default: Default value to return on failure
        **kwargs: Additional arguments passed to requests.post

    Returns:
        Parsed JSON response or default value on failure
    """
    try:
        response = safe_post(url, timeout=timeout, json=json_data, **kwargs)
        return response.json()
    except RequestException as e:
        logger.error(f"Failed to POST JSON to {url}: {e}")
        return default


# ============================================================================
# DECORATOR FOR CUSTOM FUNCTIONS
# ============================================================================

def with_retry(
    max_attempts: int = MAX_RETRIES,
    min_wait: float = MIN_WAIT_SECONDS,
    max_wait: float = MAX_WAIT_SECONDS,
    retry_exceptions: tuple = RETRY_EXCEPTIONS
):
    """
    Decorator to add retry logic to any function.

    Args:
        max_attempts: Maximum number of retry attempts
        min_wait: Minimum wait between retries (seconds)
        max_wait: Maximum wait between retries (seconds)
        retry_exceptions: Tuple of exception types to retry on

    Returns:
        Decorated function with retry logic

    Example:
        >>> @with_retry(max_attempts=5)
        ... def fetch_data():
        ...     response = requests.get('https://api.example.com')
        ...     return response.json()
    """
    return retry(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=min_wait, max=max_wait),
        retry=retry_if_exception_type(retry_exceptions),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True
    )


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def is_retryable_error(error: Exception) -> bool:
    """
    Check if an error is retryable.

    Args:
        error: Exception to check

    Returns:
        True if the error is retryable, False otherwise
    """
    if isinstance(error, RETRY_EXCEPTIONS):
        return True
    if isinstance(error, HTTPServerError):
        return 500 <= error.status_code < 600
    return False


def get_retry_stats() -> Dict[str, Any]:
    """Get retry configuration stats for monitoring."""
    return {
        'max_retries': MAX_RETRIES,
        'min_wait_seconds': MIN_WAIT_SECONDS,
        'max_wait_seconds': MAX_WAIT_SECONDS,
        'retry_exceptions': [e.__name__ for e in RETRY_EXCEPTIONS]
    }


# ============================================================================
# BACKWARD COMPATIBILITY
# ============================================================================

# Aliases for backward compatibility
http_get = safe_get
http_post = safe_post
